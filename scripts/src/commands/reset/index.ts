import { Command, Flags } from '@oclif/core';
import { MongoClient } from 'mongodb';

export default class Reset extends Command {
  static description = 'Clear out all data in the database';

  static flags = {
    db: Flags.string({
      char: 'd',
      description: 'database to reset',
      default: 'mongodb://localhost:27017/damplab',
      required: false
    })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Reset);

    // Connect to the database
    const client = await MongoClient.connect(flags.db);
    await client.connect();

    // Drop the database
    await client.db().dropDatabase();
    this.log(`Database ${flags.db} dropped`);

    await client.close();
  }
}
