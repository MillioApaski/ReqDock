import Dexie, { type EntityTable } from 'dexie';
import type { RequestModel, Environment, HistoryItem, Collection, Folder } from '../types';

class ReqDockDatabase extends Dexie {
  requests!: EntityTable<RequestModel, 'id'>;
  environments!: EntityTable<Environment, 'id'>;
  history!: EntityTable<HistoryItem, 'id'>;
  collections!: EntityTable<Collection, 'id'>;
  folders!: EntityTable<Folder, 'id'>;
  constructor() {
    super('ReqDock');
    this.version(1).stores({ requests: 'id,updatedAt', environments: 'id,name', history: 'id,at' });
    this.version(2).stores({ requests: 'id,updatedAt,collectionId,folderId', environments: 'id,name', history: 'id,at', collections: 'id,name', folders: 'id,collectionId,parentId' });
  }
}
export const db = new ReqDockDatabase();
export async function persistHistory(item: HistoryItem) {
  await db.history.put(item);
  const overflow = await db.history.orderBy('at').reverse().offset(100).primaryKeys();
  if (overflow.length) await db.history.bulkDelete(overflow);
}
