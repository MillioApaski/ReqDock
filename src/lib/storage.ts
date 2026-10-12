import Dexie, { type EntityTable } from 'dexie';
import type { RequestModel, Environment, HistoryItem } from '../types';

class ReqDockDatabase extends Dexie {
  requests!: EntityTable<RequestModel, 'id'>;
  environments!: EntityTable<Environment, 'id'>;
  history!: EntityTable<HistoryItem, 'id'>;
  constructor() {
    super('ReqDock');
    this.version(1).stores({ requests: 'id,updatedAt', environments: 'id,name', history: 'id,at' });
  }
}
export const db = new ReqDockDatabase();
export async function persistHistory(item: HistoryItem) {
  await db.history.put(item);
  const overflow = await db.history.orderBy('at').reverse().offset(100).primaryKeys();
  if (overflow.length) await db.history.bulkDelete(overflow);
}
