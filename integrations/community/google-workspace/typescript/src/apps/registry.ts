import type { HostAppModule, HostApp } from "../types";

/**
 * Registry of host app modules. Maps host app name -> module implementation.
 * Modules are registered at startup and looked up on each request.
 */
export class AppRegistry {
  private modules = new Map<HostApp, HostAppModule>();

  register(module: HostAppModule): void {
    this.modules.set(module.hostApp, module);
  }

  get(hostApp: HostApp): HostAppModule | undefined {
    return this.modules.get(hostApp);
  }

  getAll(): HostAppModule[] {
    return Array.from(this.modules.values());
  }

  has(hostApp: HostApp): boolean {
    return this.modules.has(hostApp);
  }
}
