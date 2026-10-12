import { InMemoryStorage } from './in-memory.storage.js';
import { runStorageContract } from './storage.contract.js';

runStorageContract('InMemoryStorage', () => new InMemoryStorage());
