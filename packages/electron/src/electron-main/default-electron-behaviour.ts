/********************************************************************************
 * Copyright (C) 2020 Ericsson and others.
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

import URI from '@theia/core/lib/common/uri';
import { BrowserWindow, BrowserWindowConstructorOptions, dialog } from 'electron';
import { realpathSync } from 'fs';
import { inject, injectable } from 'inversify';
import { resolve } from 'path';
import { Argv } from 'yargs';
import { ElectronApplication, ElectronApplicationContribution, ElectronApplicationSettings, ExecutionParams } from './electron-application';
const Storage = require('electron-store');
const createYargs: (argv?: string[], cwd?: string) => Argv = require('yargs/yargs');

/**
 * Override this binding to setup your own electron behavior, i.e.: What to do
 * when a user launches your application.
 */
export const ElectronBehavior = Symbol('ElectronBehavior');

/**
 * Options passed to the main/default command handler.
 */
export interface MainCommandOptions {

    /**
     * By default, the first positional argument. Should be a file or a folder.
     */
    file?: string

}

@injectable()
export class DefaultElectronBehavior implements ElectronApplicationContribution {

    @inject(ElectronApplication)
    protected readonly app: ElectronApplication;

    @inject(ElectronApplicationSettings)
    protected readonly settings: ElectronApplicationSettings;

    protected readonly electronStore = new Storage();

    launch(params: ExecutionParams): void {
        createYargs(params.argv, params.cwd)
            .command('$0 [<file>]', false,
                cmd => cmd
                    .positional('file', { type: 'string' }),
                args => this.handleMainCommand(params, {
                    file: args.file
                }),
            ).parse();
    }

    protected handleMainCommand(params: ExecutionParams, options: MainCommandOptions): void {
        const window = this.createWindow();
        const { file } = options;

        let url = new URI()
            .withScheme('file')
            .withPath(this.settings.THEIA_FRONTEND_HTML_PATH)
            .withQuery(`port=${this.app.backendPort}`);

        if (typeof file === 'string') {
            url = url.withFragment(realpathSync(resolve(params.cwd, file)));
        }

        window.loadURL(url.toString(true));
    }

    protected createWindow(): BrowserWindow {
        const electronWindow = this.app.createRawWindow(this.getBrowserWindowOptions())
            .on('ready-to-show', () => electronWindow.show());

        this.attachSaveWindowState(electronWindow);
        this.attachWillPreventUnload(electronWindow);

        return electronWindow;
    }

    protected getBrowserWindowOptions(): BrowserWindowConstructorOptions {
        // The `screen` API must be required when the application is ready.
        // See: https://electronjs.org/docs/api/screen#screen
        const { screen } = require('electron');

        // We must center by hand because \`browserWindow.center()\` fails on multi-screen setups
        // See: https://github.com/electron/electron/issues/3490
        const { bounds } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        const height = Math.floor(bounds.height * (2 / 3));
        const width = Math.floor(bounds.width * (2 / 3));

        const y = Math.floor(bounds.y + (bounds.height - height) / 2);
        const x = Math.floor(bounds.x + (bounds.width - width) / 2);

        const windowState = this.electronStore.get('windowstate', { width, height, x, y });

        return {
            ...windowState,
            show: false,
            title: this.settings.THEIA_APPLICATION_NAME,
            minWidth: 200,
            minHeight: 120,
        };
    }

    protected attachSaveWindowState(electronWindow: BrowserWindow): void {
        // Save the window geometry state on every change
        const saveWindowState = () => {
            try {
                let bounds;
                if (electronWindow.isMaximized()) {
                    bounds = this.electronStore.get('windowstate', {});
                } else {
                    bounds = electronWindow.getBounds();
                }
                this.electronStore.set('windowstate', {
                    isMaximized: electronWindow.isMaximized(),
                    width: bounds.width,
                    height: bounds.height,
                    x: bounds.x,
                    y: bounds.y
                });
            } catch (e) {
                console.error('Error while saving window state:', e);
            }
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let delayedSaveTimeout: any;
        const saveWindowStateDelayed = () => {
            if (delayedSaveTimeout) {
                clearTimeout(delayedSaveTimeout);
            }
            delayedSaveTimeout = setTimeout(saveWindowState, 1000);
        };
        electronWindow.on('close', saveWindowState);
        electronWindow.on('resize', saveWindowStateDelayed);
        electronWindow.on('move', saveWindowStateDelayed);
    }

    protected attachWillPreventUnload(electronWindow: BrowserWindow): void {
        // Fired when a beforeunload handler tries to prevent the page unloading
        electronWindow.webContents.on('will-prevent-unload', event => {
            const preventStop = 0 !== dialog.showMessageBox(electronWindow, {
                type: 'question',
                buttons: ['Yes', 'No'],
                title: 'Confirm',
                message: 'Are you sure you want to quit?',
                detail: 'Any unsaved changes will not be saved.'
            });

            if (!preventStop) {
                // This ignores the beforeunload callback, allowing the page to unload
                event.preventDefault();
            }
        });
    }

}
