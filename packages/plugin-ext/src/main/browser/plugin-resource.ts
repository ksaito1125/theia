/********************************************************************************
 * Copyright (C) 2018 TypeFox and others.
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

import { injectable, inject } from 'inversify';
import URI from '@theia/core/lib/common/uri';
import { Resource, ResourceVersion, ResourceResolver, ResourceError, ResourceSaveOptions } from '@theia/core/lib/common/resource';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { PluginFileService } from './plugin-file-service';
import { IBaseStatWithMetadata, FileOperationError, FileOperationResult } from '../../common/files';
import { VSBuffer } from '../../common/buffer';

export interface PluginResourceVersion extends ResourceVersion {
    readonly stat: IBaseStatWithMetadata
}
export namespace PluginResourceVersion {
    export function is(version: ResourceVersion | undefined): version is PluginResourceVersion {
        return !!version && ('mtime' in version || 'etag' in version);
    }
}

export class PluginResource implements Resource {

    protected readonly toDispose = new DisposableCollection();
    protected readonly onDidChangeContentsEmitter = new Emitter<void>();
    readonly onDidChangeContents: Event<void> = this.onDidChangeContentsEmitter.event;

    protected _version: PluginResourceVersion | undefined;
    get version(): PluginResourceVersion | undefined {
        return this._version;
    }

    protected uriString: string;

    constructor(
        readonly uri: URI,
        protected readonly fileService: PluginFileService
    ) {
        this.uriString = this.uri.toString();
        this.toDispose.push(this.onDidChangeContentsEmitter);
    }

    async init(): Promise<void> {
        const stat = await this.getFileStat();
        if (stat && stat.isDirectory) {
            throw new Error('The given uri is a directory: ' + this.uriString);
        }

        this.toDispose.push(this.fileSystemWatcher.onFilesChanged(event => {
            if (FileChangeEvent.isAffected(event, this.uri)) {
                this.sync();
            }
        }));
        this.toDispose.push(this.fileSystemWatcher.onDidDelete(event => {
            if (event.uri.isEqualOrParent(this.uri)) {
                this.sync();
            }
        }));
        this.toDispose.push(this.fileSystemWatcher.onDidMove(event => {
            if (event.sourceUri.isEqualOrParent(this.uri) || event.targetUri.isEqualOrParent(this.uri)) {
                this.sync();
            }
        }));
        try {
            this.toDispose.push(await this.fileSystemWatcher.watchFileChanges(this.uri));
        } catch (e) {
            console.error(e);
        }
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    async readContents(options?: { encoding?: string }): Promise<string> {
        try {
            const stat = await this.fileService.readFile(this.uri['codeUri']);
            const content = stat.value.toString();
            delete stat['value'];
            this._version = { stat };
            return content;
        } catch (e) {
            if (e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
                this._version = undefined;
                const { message, stack } = e;
                throw ResourceError.NotFound({
                    message, stack,
                    data: {
                        uri: this.uri
                    }
                });
            }
            throw e;
        }
    }

    async saveContents(content: string, options?: ResourceSaveOptions): Promise<void> {
        try {
            let resolvedOptions = options;
            if (options && options.overwriteEncoding) {
                resolvedOptions = {
                    ...options,
                    encoding: options.overwriteEncoding
                };
                delete resolvedOptions.overwriteEncoding;
            }
            const stat = await this.doSaveContents(content, resolvedOptions);
            this._version = { stat };
        } catch (e) {
            if (FileSystemError.FileIsOutOfSync.is(e)) {
                throw ResourceError.OutOfSync({ ...e.toJson(), data: { uri: this.uri } });
            }
            throw e;
        }
    }
    protected async doSaveContents(content: string, options?: { encoding?: string, version?: ResourceVersion }): Promise<FileStat> {
        const version = options && options.version || this._version;
        const stat = FileResourceVersion.is(version) && version.stat || await this.getFileStat();
        if (stat) {
            try {
                await this.fileService.writeFile(this.uri['codeUri'], VSBuffer.)
                return await this.fileService.setContent(stat, content, options);
            } catch (e) {
                if (!FileSystemError.FileNotFound.is(e)) {
                    throw e;
                }
            }
        }
        return this.fileService.createFile(this.uriString, { content, ...options });
    }

    async guessEncoding(): Promise<string | undefined> {
        return this.fileService.guessEncoding(this.uriString);
    }

    protected async sync(): Promise<void> {
        this.onDidChangeContentsEmitter.fire(undefined);
    }

}

@injectable()
export class FileResourceResolver implements ResourceResolver {

    @inject(FileSystem)
    protected readonly fileSystem: FileSystem;

    @inject(FileSystemWatcher)
    protected readonly fileSystemWatcher: FileSystemWatcher;

    async resolve(uri: URI): Promise<PluginResource> {
        if (uri.scheme !== 'file') {
            throw new Error('The given uri is not file uri: ' + uri);
        }
        const resource = new PluginResource(uri, this.fileSystem, this.fileSystemWatcher);
        await resource.init();
        return resource;
    }

}
