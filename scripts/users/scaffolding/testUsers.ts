export type TestUser = {
  name: string;
  email: string;
  password: string;
};

export const bob: TestUser = {
  name: 'Bob',
  email: 'bob@tearleads.com',
  password: 'test'
};

export const alice: TestUser = {
  name: 'Alice',
  email: 'alice@tearleads.com',
  password: 'test'
};

export const allTestUsers: TestUser[] = [bob, alice];
