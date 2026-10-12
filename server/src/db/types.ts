import type { Db } from './index';

/** A transaction handle, as passed to db.transaction() callbacks. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Anything that can run queries: the database itself or an open transaction. */
export type DbLike = Db | Tx;
