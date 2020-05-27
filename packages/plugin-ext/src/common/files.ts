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

import { URI } from 'vscode-uri';
import { Event } from '@theia/core/lib/common/event';
import { Disposable as IDisposable } from '@theia/core/lib/common/disposable';
import { VSBuffer } from './buffer';

/* eslint-disable @typescript-eslint/quotes */
/* eslint-disable @typescript-eslint/tslint/config */

export interface IFileService {

	/**
	 * Checks if this file service can handle the given resource.
	 */
    canHandleResource(resource: URI): boolean;

    /**
	 * Registers a file system provider for a certain scheme.
	 */
    registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable;

	/**
	 * Resolve the properties of a file/folder identified by the resource.
	 *
	 * If the optional parameter "resolveTo" is specified in options, the stat service is asked
	 * to provide a stat object that should contain the full graph of folders up to all of the
	 * target resources.
	 *
	 * If the optional parameter "resolveSingleChildDescendants" is specified in options,
	 * the stat service is asked to automatically resolve child folders that only
	 * contain a single element.
	 *
	 * If the optional parameter "resolveMetadata" is specified in options,
	 * the stat will contain metadata information such as size, mtime and etag.
	 */
    resolve(resource: URI, options: IResolveMetadataFileOptions): Promise<IFileStatWithMetadata>;
    resolve(resource: URI, options?: IResolveFileOptions): Promise<IFileStat>;

	/**
	 * Read the contents of the provided resource unbuffered.
	 */
    readFile(resource: URI, options?: IReadFileOptions): Promise<IFileContent>;

    /**
	 * Updates the content replacing its previous value.
	 */
    writeFile(resource: URI, content: VSBuffer, options?: IWriteFileOptions): Promise<IFileStatWithMetadata>;

    /**
	 * Moves the file/folder to a new path identified by the resource.
	 *
	 * The optional parameter overwrite can be set to replace an existing file at the location.
	 */
    move(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata>;

	/**
	 * Copies the file/folder to a path identified by the resource.
	 *
	 * The optional parameter overwrite can be set to replace an existing file at the location.
	 */
    copy(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata>;

	/**
	 * Creates a new folder with the given path. The returned promise
	 * will have the stat model object as a result.
	 */
    createFolder(resource: URI): Promise<IFileStatWithMetadata>;

	/**
	 * Deletes the provided file. The optional useTrash parameter allows to
	 * move the file to trash. The optional recursive parameter allows to delete
	 * non-empty folders recursively.
	 */
    del(resource: URI, options?: FileDeleteOptions): Promise<void>;

}

interface IBaseStat {

	/**
	 * The unified resource identifier of this file or folder.
	 */
    resource: URI;

	/**
	 * The name which is the last segment
	 * of the {{path}}.
	 */
    name: string;

	/**
	 * The size of the file.
	 *
	 * The value may or may not be resolved as
	 * it is optional.
	 */
    size?: number;

	/**
	 * The last modification date represented as millis from unix epoch.
	 *
	 * The value may or may not be resolved as
	 * it is optional.
	 */
    mtime?: number;

	/**
	 * The creation date represented as millis from unix epoch.
	 *
	 * The value may or may not be resolved as
	 * it is optional.
	 */
    ctime?: number;

	/**
	 * A unique identifier thet represents the
	 * current state of the file or directory.
	 *
	 * The value may or may not be resolved as
	 * it is optional.
	 */
    etag?: string;
}

export interface IBaseStatWithMetadata extends IBaseStat {
    mtime: number;
    ctime: number;
    etag: string;
    size: number;
}

/**
 * A file resource with meta information.
 */
export interface IFileStat extends IBaseStat {

	/**
	 * The resource is a file.
	 */
    isFile: boolean;

	/**
	 * The resource is a directory.
	 */
    isDirectory: boolean;

	/**
	 * The resource is a symbolic link.
	 */
    isSymbolicLink: boolean;

	/**
	 * The children of the file stat or undefined if none.
	 */
    children?: IFileStat[];
}

export interface IFileStatWithMetadata extends IFileStat, IBaseStatWithMetadata {
    mtime: number;
    ctime: number;
    etag: string;
    size: number;
    children?: IFileStatWithMetadata[];
}

export interface IFileContent extends IBaseStatWithMetadata {

	/**
	 * The content of a file as buffer.
	 */
    value: VSBuffer;
}

export interface IWriteFileOptions {

	/**
	 * The last known modification time of the file. This can be used to prevent dirty writes.
	 */
    readonly mtime?: number;

	/**
	 * The etag of the file. This can be used to prevent dirty writes.
	 */
    readonly etag?: string;
}

export interface IReadFileOptions extends FileReadStreamOptions {

	/**
	 * The optional etag parameter allows to return early from resolving the resource if
	 * the contents on disk match the etag. This prevents accumulated reading of resources
	 * that have been read already with the same etag.
	 * It is the task of the caller to makes sure to handle this error case from the promise.
	 */
    readonly etag?: string;
}

export interface IWriteFileOptions {

	/**
	 * The last known modification time of the file. This can be used to prevent dirty writes.
	 */
    readonly mtime?: number;

	/**
	 * The etag of the file. This can be used to prevent dirty writes.
	 */
    readonly etag?: string;
}

export interface IResolveFileOptions {

	/**
	 * Automatically continue resolving children of a directory until the provided resources
	 * are found.
	 */
    readonly resolveTo?: readonly URI[];

	/**
	 * Automatically continue resolving children of a directory if the number of children is 1.
	 */
    readonly resolveSingleChildDescendants?: boolean;

	/**
	 * Will resolve mtime, ctime, size and etag of files if enabled. This can have a negative impact
	 * on performance and thus should only be used when these values are required.
	 */
    readonly resolveMetadata?: boolean;
}

export interface IResolveMetadataFileOptions extends IResolveFileOptions {
    readonly resolveMetadata: true;
}

export interface ICreateFileOptions {

	/**
	 * Overwrite the file to create if it already exists on disk. Otherwise
	 * an error will be thrown (FILE_MODIFIED_SINCE).
	 */
    readonly overwrite?: boolean;
}

export class FileOperationError extends Error {
    constructor(message: string, public fileOperationResult: FileOperationResult, public options?: IReadFileOptions & IWriteFileOptions & ICreateFileOptions) {
        super(message);
    }
}

export const enum FileOperationResult {
    FILE_IS_DIRECTORY,
    FILE_NOT_FOUND,
    FILE_NOT_MODIFIED_SINCE,
    FILE_MODIFIED_SINCE,
    FILE_MOVE_CONFLICT,
    FILE_READ_ONLY,
    FILE_PERMISSION_DENIED,
    FILE_TOO_LARGE,
    FILE_INVALID_PATH,
    FILE_EXCEEDS_MEMORY_LIMIT,
    FILE_NOT_DIRECTORY,
    FILE_OTHER_ERROR
}

export interface FileOverwriteOptions {
    overwrite: boolean;
}

export interface FileReadStreamOptions {

	/**
	 * Is an integer specifying where to begin reading from in the file. If position is undefined,
	 * data will be read from the current file position.
	 */
    readonly position?: number;

	/**
	 * Is an integer specifying how many bytes to read from the file. By default, all bytes
	 * will be read.
	 */
    readonly length?: number;

	/**
	 * If provided, the size of the file will be checked against the limits.
	 */
    limits?: {
        readonly size?: number;
        readonly memory?: number;
    };
}

export interface FileWriteOptions {
    overwrite: boolean;
    create: boolean;
}

export interface FileOpenOptions {
    create: boolean;
}

export interface FileDeleteOptions {
    recursive: boolean;
    useTrash: boolean;
}

export enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
    SymbolicLink = 64
}

export interface IStat {
    type: FileType;

	/**
	 * The last modification date represented as millis from unix epoch.
	 */
    mtime: number;

	/**
	 * The creation date represented as millis from unix epoch.
	 */
    ctime: number;

    size: number;
}

export interface IWatchOptions {
    recursive: boolean;
    excludes: string[];
}

export const enum FileSystemProviderCapabilities {
    FileReadWrite = 1 << 1,
    FileOpenReadWriteClose = 1 << 2,

    FileFolderCopy = 1 << 3,

    PathCaseSensitive = 1 << 10,
    Readonly = 1 << 11,

    Trash = 1 << 12
}

export enum FileSystemProviderErrorCode {
    FileExists = 'EntryExists',
    FileNotFound = 'EntryNotFound',
    FileNotADirectory = 'EntryNotADirectory',
    FileIsADirectory = 'EntryIsADirectory',
    NoPermissions = 'NoPermissions',
    Unavailable = 'Unavailable',
    Unknown = 'Unknown'
}

export class FileSystemProviderError extends Error {

    constructor(message: string, public readonly code: FileSystemProviderErrorCode) {
        super(message);
    }
}

export function createFileSystemProviderError(error: Error | string, code: FileSystemProviderErrorCode): FileSystemProviderError {
    const providerError = new FileSystemProviderError(error.toString(), code);
    markAsFileSystemProviderError(providerError, code);

    return providerError;
}

export function ensureFileSystemProviderError(error?: Error): Error {
    if (!error) {
        return createFileSystemProviderError('Unknown Error', FileSystemProviderErrorCode.Unknown); // https://github.com/Microsoft/vscode/issues/72798
    }

    return error;
}

export interface IFileSystemProvider {

    readonly capabilities: FileSystemProviderCapabilities;
    readonly onDidChangeCapabilities: Event<void>;

    readonly onDidErrorOccur?: Event<string>; // TODO@ben remove once file watchers are solid

    readonly onDidChangeFile: Event<readonly IFileChange[]>;
    watch(resource: URI, opts: IWatchOptions): IDisposable;

    stat(resource: URI): Promise<IStat>;
    mkdir(resource: URI): Promise<void>;
    readdir(resource: URI): Promise<[string, FileType][]>;
    delete(resource: URI, opts: FileDeleteOptions): Promise<void>;

    rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void>;
    copy?(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void>;

    readFile?(resource: URI): Promise<Uint8Array>;
    writeFile?(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void>;

    open?(resource: URI, opts: FileOpenOptions): Promise<number>;
    close?(fd: number): Promise<void>;
    read?(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>;
    write?(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>;
}

export interface IFileSystemProviderWithFileReadWriteCapability extends IFileSystemProvider {
    readFile(resource: URI): Promise<Uint8Array>;
    writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void>;
}

export function hasReadWriteCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithFileReadWriteCapability {
    return !!(provider.capabilities & FileSystemProviderCapabilities.FileReadWrite);
}

export interface IFileSystemProviderWithFileFolderCopyCapability extends IFileSystemProvider {
    copy(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void>;
}

export function hasFileFolderCopyCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithFileFolderCopyCapability {
    return !!(provider.capabilities & FileSystemProviderCapabilities.FileFolderCopy);
}

export interface IFileSystemProviderWithOpenReadWriteCloseCapability extends IFileSystemProvider {
    open(resource: URI, opts: FileOpenOptions): Promise<number>;
    close(fd: number): Promise<void>;
    read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>;
    write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>;
}

export function hasOpenReadWriteCloseCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithOpenReadWriteCloseCapability {
    return !!(provider.capabilities & FileSystemProviderCapabilities.FileOpenReadWriteClose);
}

export function markAsFileSystemProviderError(error: Error, code: FileSystemProviderErrorCode): Error {
    error.name = code ? `${code} (FileSystemError)` : `FileSystemError`;

    return error;
}

export function toFileSystemProviderErrorCode(error: Error | undefined | null): FileSystemProviderErrorCode {

    // Guard against abuse
    if (!error) {
        return FileSystemProviderErrorCode.Unknown;
    }

    // FileSystemProviderError comes with the code
    if (error instanceof FileSystemProviderError) {
        return error.code;
    }

    // Any other error, check for name match by assuming that the error
    // went through the markAsFileSystemProviderError() method
    const match = /^(.+) \(FileSystemError\)$/.exec(error.name);
    if (!match) {
        return FileSystemProviderErrorCode.Unknown;
    }

    switch (match[1]) {
        case FileSystemProviderErrorCode.FileExists: return FileSystemProviderErrorCode.FileExists;
        case FileSystemProviderErrorCode.FileIsADirectory: return FileSystemProviderErrorCode.FileIsADirectory;
        case FileSystemProviderErrorCode.FileNotADirectory: return FileSystemProviderErrorCode.FileNotADirectory;
        case FileSystemProviderErrorCode.FileNotFound: return FileSystemProviderErrorCode.FileNotFound;
        case FileSystemProviderErrorCode.NoPermissions: return FileSystemProviderErrorCode.NoPermissions;
        case FileSystemProviderErrorCode.Unavailable: return FileSystemProviderErrorCode.Unavailable;
    }

    return FileSystemProviderErrorCode.Unknown;
}

export function toFileOperationResult(error: Error): FileOperationResult {

    // FileSystemProviderError comes with the result already
    if (error instanceof FileOperationError) {
        return error.fileOperationResult;
    }

    // Otherwise try to find from code
    switch (toFileSystemProviderErrorCode(error)) {
        case FileSystemProviderErrorCode.FileNotFound:
            return FileOperationResult.FILE_NOT_FOUND;
        case FileSystemProviderErrorCode.FileIsADirectory:
            return FileOperationResult.FILE_IS_DIRECTORY;
        case FileSystemProviderErrorCode.FileNotADirectory:
            return FileOperationResult.FILE_NOT_DIRECTORY;
        case FileSystemProviderErrorCode.NoPermissions:
            return FileOperationResult.FILE_PERMISSION_DENIED;
        case FileSystemProviderErrorCode.FileExists:
            return FileOperationResult.FILE_MOVE_CONFLICT;
        default:
            return FileOperationResult.FILE_OTHER_ERROR;
    }
}

/**
 * Possible changes that can occur to a file.
 */
export const enum FileChangeType {
    UPDATED = 0,
    ADDED = 1,
    DELETED = 2
}

/**
 * Identifies a single change in a file.
 */
export interface IFileChange {

	/**
	 * The type of change that occurred to the file.
	 */
    readonly type: FileChangeType;

	/**
	 * The unified resource identifier of the file that changed.
	 */
    readonly resource: URI;
}

/**
 * A hint to disable etag checking for reading/writing.
 */
export const ETAG_DISABLED = '';

export function etag(stat: { mtime: number, size: number }): string;
export function etag(stat: { mtime: number | undefined, size: number | undefined }): string | undefined;
export function etag(stat: { mtime: number | undefined, size: number | undefined }): string | undefined {
    if (typeof stat.size !== 'number' || typeof stat.mtime !== 'number') {
        return undefined;
    }

    return stat.mtime.toString(29) + stat.size.toString(31);
}
