// ServiceRegistry implementation (contract client/module v0). Duplicate keys and missing keys are composition-root
// bugs and throw with the key name.

import type { ServiceRegistry, ServiceTypes } from "@moon-cleanup/shared";

export function createServiceRegistry<S extends ServiceTypes>(): ServiceRegistry<S> {
  const services = new Map<string, unknown>();
  return {
    get<K extends keyof S & string>(key: K): S[K] {
      if (!services.has(key)) throw new Error(`service "${key}" is not registered (module init order or wiring bug)`);
      return services.get(key) as S[K];
    },
    has(key) {
      return services.has(key);
    },
    register<K extends keyof S & string>(key: K, service: S[K]): void {
      if (services.has(key)) throw new Error(`service "${key}" is already registered`);
      services.set(key, service);
    },
  };
}
