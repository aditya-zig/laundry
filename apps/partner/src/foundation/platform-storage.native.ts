import { openNativeSqliteSessionStores, StorageError, type PlatformSessionStores } from '@laundry/app-foundation';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';

export const requiresProtectedStorage = true;
const databaseName = 'laundry-rider-session-v1.db';
const keyName = 'laundry-rider-journal-key-v1';
const keyOptions = { keychainService: 'laundry.rider.session', keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
export async function createPlatformStores(): Promise<PlatformSessionStores> {
  if (!await SecureStore.isAvailableAsync() || typeof SQLite.defaultDatabaseDirectory !== 'string') {
    throw new StorageError('Device-protected session storage is unavailable in this runtime');
  }
  const directory = SQLite.defaultDatabaseDirectory.replace(/\/$/, '');
  const databaseUri = `${directory.startsWith('file://') ? directory : `file://${directory}`}/${databaseName}`;
  const stores = await openNativeSqliteSessionStores({
    deviceKey: {
      read: () => SecureStore.getItemAsync(keyName, keyOptions),
      write: value => value === null ? SecureStore.deleteItemAsync(keyName, keyOptions) : SecureStore.setItemAsync(keyName, value, keyOptions),
    },
    async databaseExists() { return (await FileSystem.getInfoAsync(databaseUri)).exists; },
    async newDatabaseKey() { return Array.from(await Crypto.getRandomBytesAsync(32), byte => byte.toString(16).padStart(2, '0')).join(''); },
    openDatabase: () => SQLite.openDatabaseAsync(databaseName, { useNewConnection: true }),
  });
  return { ...stores, generateKey: () => Crypto.randomUUID() };
}
