export interface PgFieldDescription {
  name: string;
  tableID: number;
  columnID: number;
  dataTypeID: number;
  dataTypeSize: number;
  dataTypeModifier: number;
  format: 'text' | 'binary';
}

export interface PgQueryResult<
  T extends Record<string, unknown> = Record<string, unknown>
> {
  rows: T[];
  rowCount: number;
  command: string;
  oid: number;
  fields: PgFieldDescription[];
}

interface PgQueryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<PgQueryResult<T>>;
}

export interface PgPoolClient extends PgQueryable {
  release(): void;
}

export interface PgPool extends PgQueryable {
  connect(): Promise<PgPoolClient>;
  end(): Promise<void>;
}
