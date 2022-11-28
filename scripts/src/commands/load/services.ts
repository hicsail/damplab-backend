import { Command, Flags } from '@oclif/core';
import { MongoClient, ObjectId } from 'mongodb';
import { services } from '../../assets/services.json';

/**
 * Script to load in services from a JSON file
 */
export default class LoadServices extends Command {
  static description = 'Load services from a JSON file';

  static flags = {
    file: Flags.string({
      char: 'f',
      description: 'JSON file to load',
      required: false,
      default: 'src/assets/services.json'
    }),
    db: Flags.string({
      char: 'd',
      description: 'database to load into',
      default: 'mongodb://localhost:27017/damplab',
      required: false
    }),
    collection: Flags.string({
      char: 'c',
      description: 'collection to load into',
      default: 'damplabservices',
      required: false
    })
  };

  client: MongoClient | null = null;
  flags: any;

  async run(): Promise<void> {
    const { flags } = await this.parse(LoadServices);
    this.flags = flags;

    // Connect to the database
    this.client = await MongoClient.connect(flags.db);
    await this.client.connect();

    // Insert the services into the database
    await this.insertIntoDatabase(services);

    // Close the connection
    await this.client.close();
  }

  /**
   * Converts the services from the JSON format into a format that can be
   * inserted into the database. This handles the logic of connecting
   * the "allowedConnections" up
   *
   * TODO: If an error takes place, remove the services that were already
   *       inserted
   */
  async insertIntoDatabase(services: any[]): Promise<void> {
    /** Maps the ID as defined in the JSON file to the ID in the database */
    const serviceMap = new Map<string, ObjectId>();

    // For each of the services, save the info not including
    // the allowed connections
    for (const service of services) {
      // Get a copy of the data without the allowed connections and id
      const copy = { ...service };
      delete copy.allowedConnections;
      delete copy.id;

      // Insert the service into the database
      const result = await this.client?.db().collection(this.flags.collection).insertOne(copy);

      // Update the map
      serviceMap.set(service.id, result.insertedId);
    }

    // For each of the services, update the allowed connections
    for (const service of services) {
      // Get the IDs of the allowed connections
      const allowedConnections = service.allowedConnections.map((id: string) => {
        if (!serviceMap.has(id)) {
          throw new Error(`Service "${service.id}" has an invalid allowed connection "${id}"`);
        }
        return serviceMap.get(id);
      });

      // Update the service
      await this.client
        ?.db()
        .collection(this.flags.collection)
        .updateOne(
          {
            name: service.name
          },
          {
            $set: { allowedConnections: allowedConnections }
          }
        );
    }
  }
}
