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

import { ContributionProvider } from '@theia/core/lib/common/contribution-provider';
import { MaybePromise } from '@theia/core/lib/common/types';
import { ElectronSecurityToken } from '@theia/core/lib/electron-common/electron-token';
import { ChildProcess, fork, ForkOptions } from 'child_process';
import * as electron from 'electron';
import { app, BrowserWindow, BrowserWindowConstructorOptions, Event as ElectronEvent, shell } from 'electron';
import { inject, injectable, named } from 'inversify';
import { AddressInfo } from 'net';

export interface ExecutionParams {
    secondInstance: boolean
    argv: string[]
    cwd: string
}

export const ElectronApplicationSettings = Symbol('ElectronApplicationSettings');
export interface ElectronApplicationSettings {
    THEIA_APPLICATION_NAME: string
    THEIA_APP_PROJECT_PATH: string
    THEIA_BACKEND_MAIN_PATH: string
    THEIA_FRONTEND_HTML_PATH: string
}

export const ElectronApplicationContribution = Symbol('ElectronApplicationContribution');
export interface ElectronApplicationContribution {
    /**
     * The application is ready and is starting. This is the time to initialize
     * services global to this process.
     *
     * This event is fired when the process starts for the first time.
     */
    start?(): MaybePromise<void>;
    /**
     * Entry point either after the `start` or `second-instance` events.
     *
     * Hook to this event in order to access resolved command line arguments.
     *
     * If your application is a single-instance application, this hook could be
     * called multiple times.
     */
    launch?(params: ExecutionParams): MaybePromise<void>;
    /**
     * The application is stopping.
     */
    stop?(): MaybePromise<void>;
}

@injectable()
export class ElectronApplication {

    @inject(ContributionProvider) @named(ElectronApplicationContribution)
    protected readonly electronApplicationContributions: ContributionProvider<ElectronApplicationContribution>;

    @inject(ElectronApplicationSettings)
    protected readonly settings: ElectronApplicationSettings;

    @inject(ElectronSecurityToken)
    protected electronSecurityToken: ElectronSecurityToken;

    /**
     * There is no backend process in `devMode`.
     */
    protected backendProcess: ChildProcess | undefined;

    protected _backendPort: number | undefined;

    get backendPort(): number {
        if (typeof this._backendPort === 'undefined') {
            throw new Error('backend port is not set');
        }
        return this._backendPort;
    }

    async start(): Promise<void> {
        this.hookApplicationEvents();
        await this.startBackend().then(port => this._backendPort = port);
        if (!app.isReady()) {
            await app.whenReady();
        }
        await this.attachElectronSecurityToken(this.backendPort);
        await this.startContributions();
        await this.launchContributions({
            secondInstance: false,
            argv: process.argv,
            cwd: process.cwd(),
        });
    }

    /**
     * Use this rather than creating `BrowserWindow` instances from scratch,
     * since some security parameters need to be set, this method will do it.
     *
     * Only a minimal amount of events will be hooked by this method, you still
     * need to bind your own logic on top of the returned `BrowserWindow`.
     *
     * @param options
     */
    createRawWindow(options: BrowserWindowConstructorOptions): BrowserWindow {
        const electronWindow = new BrowserWindow(options);
        // Prevent openning arbitrary links in BrowserWindow instances.
        // A link is to be displayed in the user's default browser.
        electronWindow.webContents.on('new-window', (event, url) => {
            event.preventDefault();
            shell.openExternal(url);
        });
        return electronWindow;
    }

    /**
     * "Gently" close all windows, application will not stop if a `beforeunload`
     * handler returns `false`.
     */
    requestStop(): void {
        app.quit();
    }

    /**
     * Starts the NodeJS backend server.
     *
     * @return Running server's port promise.
     */
    protected async startBackend(): Promise<number> {
        const devMode = process.defaultApp || /node_modules[\/]electron[\/]/.test(process.execPath);

        // We cannot use the \`process.cwd()\` as the application project path (the location of the \`package.json\` in other words)
        // in a bundled electron application because it depends on the way we start it. For instance, on OS X, these are a differences:
        // https://github.com/eclipse-theia/theia/issues/3297#issuecomment-439172274
        process.env.THEIA_APP_PROJECT_PATH = this.settings.THEIA_APP_PROJECT_PATH;

        // Set the electron version for both the dev and the production mode. (https://github.com/eclipse-theia/theia/issues/3254)
        // Otherwise, the forked backend processes will not know that they're serving the electron frontend.
        if (process.versions && typeof process.versions.electron !== 'undefined') {
            process.env.THEIA_ELECTRON_VERSION = process.versions.electron;
        }

        return new Promise<number>(async (resolve, reject) => {
            if (devMode) {
                process.env[ElectronSecurityToken] = JSON.stringify(this.electronSecurityToken);
                // The backend server main file is supposed to export a promise
                // resolving with the port used by the http(s) server.
                require(this.settings.THEIA_BACKEND_MAIN_PATH).then((address: AddressInfo) => resolve(address.port), reject);
            } else {
                // The backend server main file is supposed to also send via IPC
                // the resolved http(s) server port.
                this.backendProcess = fork(this.settings.THEIA_BACKEND_MAIN_PATH, [], await this.getForkOptions());
                // Port number sent over IPC:
                this.backendProcess.on('message', (address: AddressInfo) => resolve(address.port));
                this.backendProcess.on('error', reject);
            }
        });
    }

    protected async getForkOptions(): Promise<ForkOptions> {
        return {
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: 1,
                [ElectronSecurityToken]: JSON.stringify(this.electronSecurityToken),
            },
        };
    }

    protected async attachElectronSecurityToken(port: number): Promise<void> {
        await new Promise((resolve, reject) => {
            electron.session.defaultSession!.cookies.set({
                url: `http://localhost:${port}`,
                name: ElectronSecurityToken,
                value: JSON.stringify(this.electronSecurityToken),
            }, error => error ? reject(error) : resolve());
        });
    }

    protected hookApplicationEvents(): void {
        app.on('will-quit', this.onWillQuit.bind(this));
        app.on('second-instance', this.onSecondInstance.bind(this));
    }

    protected async onWillQuit(event: ElectronEvent): Promise<void> {
        await this.stop();
    }

    protected async onSecondInstance(event: ElectronEvent, argv: string[], cwd: string): Promise<void> {
        await this.launchContributions({ argv, cwd, secondInstance: true });
    }

    protected async startContributions(): Promise<void> {
        const promises = [];
        for (const contribution of this.electronApplicationContributions.getContributions()) {
            if (contribution.start) {
                promises.push(contribution.start());
            }
        }
        await Promise.all(promises);
    }

    protected async launchContributions(params: ExecutionParams): Promise<void> {
        const promises = [];
        for (const contribution of this.electronApplicationContributions.getContributions()) {
            if (contribution.launch) {
                promises.push(contribution.launch(params));
            }
        }
        await Promise.all(promises);
    }

    protected async stopContributions(): Promise<void> {
        const promises = [];
        for (const contribution of this.electronApplicationContributions.getContributions()) {
            if (contribution.stop) {
                promises.push(contribution.stop());
            }
        }
        await Promise.all(promises);
    }

    protected async stop(): Promise<void> {
        let code = 0;
        try {
            await this.stopContributions();
        } catch (error) {
            console.error(error);
            code = error && error.code || 1;
        }
        app.exit(code);
    }

}
