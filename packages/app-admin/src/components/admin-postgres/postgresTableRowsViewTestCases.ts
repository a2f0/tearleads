const defaultSchema = 'public';
const defaultTableName = 'users';

const minimalColumns = [
  { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
];

const nameColumns = [
  { name: 'name', type: 'text', nullable: true, ordinalPosition: 1 }
];

const idNameColumns = [
  { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 },
  { name: 'name', type: 'text', nullable: true, ordinalPosition: 2 }
];

const emailColumns = [
  { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 },
  { name: 'email', type: 'text', nullable: true, ordinalPosition: 2 }
];

const jsonColumns = [
  { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 },
  { name: 'json', type: 'jsonb', nullable: true, ordinalPosition: 2 }
];

const singleIdRow = [{ id: 1 }];
const singleNameRow = [{ name: 'Alice' }];
const nameRows = [{ name: 'Alice' }, { name: 'Bob' }];
const jsonRow = [{ bool: false, json: { a: 1 }, undef: undefined }];

export {
  defaultSchema,
  defaultTableName,
  emailColumns,
  idNameColumns,
  jsonColumns,
  jsonRow,
  minimalColumns,
  nameColumns,
  nameRows,
  singleIdRow,
  singleNameRow
};
