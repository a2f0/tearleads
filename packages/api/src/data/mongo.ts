import {
  type Db,
  type Document,
  MongoClient,
  type MongoClientOptions
} from 'mongodb';

export class MongoDB {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private readonly uri: string;
  private readonly dbName: string;

  constructor(uri: string, dbName: string) {
    this.uri = uri;
    this.dbName = dbName;
  }

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    const options: MongoClientOptions = {
      maxPoolSize: 10,
      minPoolSize: 5
    };

    this.client = new MongoClient(this.uri, options);
    await this.client.connect();
    this.db = this.client.db(this.dbName);

    console.log(`Connected to MongoDB database: ${this.dbName}`);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      console.log('Disconnected from MongoDB');
    }
  }

  getDb(): Db {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  isConnected(): boolean {
    return this.client !== null && this.db !== null;
  }

  getCollection<T extends Document = Document>(name: string) {
    return this.getDb().collection<T>(name);
  }
}

let mongoInstance: MongoDB | null = null;

export function getMongoInstance(uri?: string, dbName?: string): MongoDB {
  if (!mongoInstance) {
    if (!uri || !dbName) {
      throw new Error(
        'MongoDB URI and database name are required for initial connection'
      );
    }
    mongoInstance = new MongoDB(uri, dbName);
  }
  return mongoInstance;
}

export async function initMongo(uri: string, dbName: string): Promise<MongoDB> {
  const mongo = getMongoInstance(uri, dbName);
  await mongo.connect();
  return mongo;
}
