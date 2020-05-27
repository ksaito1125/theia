/********************************************************************************
 * Copyright (C) 2020 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable max-len */
/* eslint-disable @typescript-eslint/tslint/config */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { URI } from 'vscode-uri';
import { interfaces } from 'inversify';
import { VSBuffer } from '../../common/buffer';
import { Disposable } from '@theia/core/lib/common/disposable';
import { Event, Emitter } from '@theia/core/lib/common/event';
import { MAIN_RPC_CONTEXT, FileSystemMain, FileSystemExt, IFileChangeDto } from '../../common/plugin-api-rpc';
import { RPCProtocol } from '../../common/rpc-protocol';
import { UriComponents } from '../../common/uri-components';
import {
    FileSystemProviderCapabilities, IStat, FileType, FileSystemProviderErrorCode, FileOverwriteOptions, FileDeleteOptions, FileOpenOptions, FileWriteOptions, IWatchOptions,
    IFileSystemProviderWithFileReadWriteCapability, IFileSystemProviderWithOpenReadWriteCloseCapability, IFileSystemProviderWithFileFolderCopyCapability,
    IFileService, IFileStat, IFileChange, FileOperationError, FileOperationResult
} from '../../common/files';
import { PluginFileService } from './plugin-file-service';

type IDisposable = Disposable;

export class FileSystemMainImpl implements FileSystemMain, Disposable {

    private readonly _proxy: FileSystemExt;
    private readonly _fileProvider = new Map<number, RemoteFileSystemProvider>();
    private readonly _fileService: IFileService;

    constructor(rpc: RPCProtocol, container: interfaces.Container) {
        this._proxy = rpc.getProxy(MAIN_RPC_CONTEXT.FILE_SYSTEM_EXT);
        this._fileService = container.get(PluginFileService);
    }

    dispose(): void {
        this._fileProvider.forEach(value => value.dispose());
        this._fileProvider.clear();
    }

    $registerFileSystemProvider(handle: number, scheme: string, capabilities: FileSystemProviderCapabilities): void {
        this._fileProvider.set(handle, new RemoteFileSystemProvider(this._fileService, scheme, capabilities, handle, this._proxy));
    }

    $unregisterProvider(handle: number): void {
        const provider = this._fileProvider.get(handle);
        if (provider) {
            provider.dispose();
            this._fileProvider.delete(handle);
        }
    }

    $onFileSystemChange(handle: number, changes: IFileChangeDto[]): void {
        const fileProvider = this._fileProvider.get(handle);
        if (!fileProvider) {
            throw new Error('Unknown file provider');
        }
        fileProvider.$onFileSystemChange(changes);
    }

    // --- consumer fs, vscode.workspace.fs

    $stat(uri: UriComponents): Promise<IStat> {
        return this._fileService.resolve(URI.revive(uri), { resolveMetadata: true }).then(stat => ({
            ctime: stat.ctime,
            mtime: stat.mtime,
            size: stat.size,
            type: FileSystemMainImpl._asFileType(stat)
        })).catch(FileSystemMainImpl._handleError);
    }

    $readdir(uri: UriComponents): Promise<[string, FileType][]> {
        return this._fileService.resolve(URI.revive(uri), { resolveMetadata: false }).then(stat => {
            if (!stat.isDirectory) {
                const err = new Error(stat.name);
                err.name = FileSystemProviderErrorCode.FileNotADirectory;
                throw err;
            }
            return !stat.children ? [] : stat.children.map(child => [child.name, FileSystemMainImpl._asFileType(child)] as [string, FileType]);
        }).catch(FileSystemMainImpl._handleError);
    }

    private static _asFileType(stat: IFileStat): FileType {
        let res = 0;
        if (stat.isFile) {
            res += FileType.File;

        } else if (stat.isDirectory) {
            res += FileType.Directory;
        }
        if (stat.isSymbolicLink) {
            res += FileType.SymbolicLink;
        }
        return res;
    }

    $readFile(uri: UriComponents): Promise<VSBuffer> {
        return this._fileService.readFile(URI.revive(uri)).then(file => file.value).catch(FileSystemMainImpl._handleError);
    }

    $writeFile(uri: UriComponents, content: VSBuffer): Promise<void> {
        return this._fileService.writeFile(URI.revive(uri), content)
            .then(() => undefined).catch(FileSystemMainImpl._handleError);
    }

    $rename(source: UriComponents, target: UriComponents, opts: FileOverwriteOptions): Promise<void> {
        return this._fileService.move(URI.revive(source), URI.revive(target), opts.overwrite)
            .then(() => undefined).catch(FileSystemMainImpl._handleError);
    }

    $copy(source: UriComponents, target: UriComponents, opts: FileOverwriteOptions): Promise<void> {
        return this._fileService.copy(URI.revive(source), URI.revive(target), opts.overwrite)
            .then(() => undefined).catch(FileSystemMainImpl._handleError);
    }

    $mkdir(uri: UriComponents): Promise<void> {
        return this._fileService.createFolder(URI.revive(uri))
            .then(() => undefined).catch(FileSystemMainImpl._handleError);
    }

    $delete(uri: UriComponents, opts: FileDeleteOptions): Promise<void> {
        return this._fileService.del(URI.revive(uri), opts).catch(FileSystemMainImpl._handleError);
    }

    private static _handleError(err: any): never {
        if (err instanceof FileOperationError) {
            switch (err.fileOperationResult) {
                case FileOperationResult.FILE_NOT_FOUND:
                    err.name = FileSystemProviderErrorCode.FileNotFound;
                    break;
                case FileOperationResult.FILE_IS_DIRECTORY:
                    err.name = FileSystemProviderErrorCode.FileIsADirectory;
                    break;
                case FileOperationResult.FILE_PERMISSION_DENIED:
                    err.name = FileSystemProviderErrorCode.NoPermissions;
                    break;
                case FileOperationResult.FILE_MOVE_CONFLICT:
                    err.name = FileSystemProviderErrorCode.FileExists;
                    break;
            }
        }

        throw err;
    }

}

class RemoteFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability, IFileSystemProviderWithOpenReadWriteCloseCapability, IFileSystemProviderWithFileFolderCopyCapability {

    private readonly _onDidChange = new Emitter<readonly IFileChange[]>();
    private readonly _registration: IDisposable;

    readonly onDidChangeFile: Event<readonly IFileChange[]> = this._onDidChange.event;

    readonly capabilities: FileSystemProviderCapabilities;
    readonly onDidChangeCapabilities: Event<void> = Event.None;

    constructor(
        fileService: IFileService,
        scheme: string,
        capabilities: FileSystemProviderCapabilities,
        private readonly _handle: number,
        private readonly _proxy: FileSystemExt
    ) {
        this.capabilities = capabilities;
        this._registration = fileService.registerProvider(scheme, this);
    }

    dispose(): void {
        this._registration.dispose();
        this._onDidChange.dispose();
    }

    watch(resource: URI, opts: IWatchOptions) {
        const session = Math.random();
        this._proxy.$watch(this._handle, session, resource, opts);
        return Disposable.create(() => {
            this._proxy.$unwatch(this._handle, session);
        });
    }

    $onFileSystemChange(changes: IFileChangeDto[]): void {
        this._onDidChange.fire(changes.map(RemoteFileSystemProvider._createFileChange));
    }

    private static _createFileChange(dto: IFileChangeDto): IFileChange {
        return { resource: URI.revive(dto.resource), type: dto.type };
    }

    // --- forwarding calls

    stat(resource: URI): Promise<IStat> {
        return this._proxy.$stat(this._handle, resource).then(undefined, err => {
            throw err;
        });
    }

    readFile(resource: URI): Promise<Uint8Array> {
        return this._proxy.$readFile(this._handle, resource).then(buffer => buffer.buffer);
    }

    writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
        return this._proxy.$writeFile(this._handle, resource, VSBuffer.wrap(content), opts);
    }

    delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
        return this._proxy.$delete(this._handle, resource, opts);
    }

    mkdir(resource: URI): Promise<void> {
        return this._proxy.$mkdir(this._handle, resource);
    }

    readdir(resource: URI): Promise<[string, FileType][]> {
        return this._proxy.$readdir(this._handle, resource);
    }

    rename(resource: URI, target: URI, opts: FileOverwriteOptions): Promise<void> {
        return this._proxy.$rename(this._handle, resource, target, opts);
    }

    copy(resource: URI, target: URI, opts: FileOverwriteOptions): Promise<void> {
        return this._proxy.$copy(this._handle, resource, target, opts);
    }

    open(resource: URI, opts: FileOpenOptions): Promise<number> {
        return this._proxy.$open(this._handle, resource, opts);
    }

    close(fd: number): Promise<void> {
        return this._proxy.$close(this._handle, fd);
    }

    read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
        return this._proxy.$read(this._handle, fd, pos, length).then(readData => {
            data.set(readData.buffer, offset);
            return readData.byteLength;
        });
    }

    write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
        return this._proxy.$write(this._handle, fd, pos, VSBuffer.wrap(data).slice(offset, offset + length));
    }
}
