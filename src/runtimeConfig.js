/**
 * Runtime configuration overrides.
 *
 * The base config object (from config.js) is deep-frozen at import time.
 * Settings that can be changed at runtime via the API (streamOutput, logPrompt,
 * fullAccess, modelOverride) are stored here and resolved transparently via
 * getEffectiveConfig(), which returns a Proxy that overlays runtime values
 * on top of the frozen base config.
 */
const overrides = {};

/**
 * Set a runtime override for a claude config key.
 * @param {string} key - The config key (e.g. 'streamOutput', 'logPrompt')
 * @param {*} value - The new value
 */
export function setRuntime(key, value) {
  overrides[key] = value;
}

/**
 * Get a runtime override value, or undefined if not set.
 * @param {string} key
 * @returns {*}
 */
export function getRuntime(key) {
  return overrides[key];
}

/**
 * Check whether a runtime override exists for the given key.
 * @param {string} key
 * @returns {boolean}
 */
export function hasRuntime(key) {
  return key in overrides;
}

/**
 * Get a config value with runtime override support.
 * Returns the runtime value if set, otherwise the base value.
 * @param {string} key
 * @param {*} baseValue
 * @returns {*}
 */
export function resolveRuntime(key, baseValue) {
  return key in overrides ? overrides[key] : baseValue;
}

/** Keys that are allowed to be overridden at runtime */
const RUNTIME_KEYS = new Set(['streamOutput', 'logPrompt', 'fullAccess', 'modelOverride']);

/**
 * Create a Proxy-wrapped config object where `config.claude.<runtimeKey>`
 * reads from runtime overrides first, falling back to the frozen base value.
 * All other properties are read directly from the frozen config.
 *
 * This allows all existing code that reads `config.claude.streamOutput` etc.
 * to get the runtime-overridden value without any changes at read sites.
 *
 * Note: We use empty objects as proxy targets instead of the frozen config
 * objects themselves, because JS Proxy invariants require that `get` on a
 * non-configurable, non-writable property returns the target's actual value.
 * Using unfrozen targets avoids this constraint while still delegating reads
 * to the frozen config.
 *
 * @param {object} frozenConfig - The deep-frozen base config object
 * @returns {object} A Proxy that transparently resolves runtime overrides
 */
export function getEffectiveConfig(frozenConfig) {
  const claudeProxy = new Proxy({}, {
    get(_target, prop) {
      if (RUNTIME_KEYS.has(prop) && prop in overrides) {
        return overrides[prop];
      }
      return frozenConfig.claude[prop];
    },
    set() {
      throw new TypeError(
        'Cannot mutate config directly. Use setRuntime() from runtimeConfig.js for runtime overrides.'
      );
    },
    has(_target, prop) {
      return prop in frozenConfig.claude;
    },
    ownKeys() {
      return Reflect.ownKeys(frozenConfig.claude);
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (prop in frozenConfig.claude) {
        return { configurable: true, enumerable: true, writable: false, value: frozenConfig.claude[prop] };
      }
      return undefined;
    }
  });

  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'claude') {
        return claudeProxy;
      }
      return frozenConfig[prop];
    },
    set() {
      throw new TypeError(
        'Cannot mutate config directly. Use setRuntime() from runtimeConfig.js for runtime overrides.'
      );
    },
    has(_target, prop) {
      return prop in frozenConfig;
    },
    ownKeys() {
      return Reflect.ownKeys(frozenConfig);
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (prop in frozenConfig) {
        return { configurable: true, enumerable: true, writable: false, value: frozenConfig[prop] };
      }
      return undefined;
    }
  });
}
