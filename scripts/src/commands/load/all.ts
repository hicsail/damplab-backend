import { Command, Flags } from '@oclif/core';
import { MongoClient, ObjectId } from 'mongodb';
import { services } from '../../assets/services.json';
import { categories } from '../../assets/categories.json';
import { bundles } from '../../assets/bundles.json';

/**
 * Script to load in services from a JSON file
 */
export default class LoadDatabase extends Command {
  static description = 'Load services from a JSON file';

  static flags = {
    services: Flags.string({
      char: 's',
      description: 'JSON file to load containing services',
      required: false,
      default: 'src/assets/services.json'
    }),
    categories: Flags.string({
      char: 'c',
      description: 'JSON file to load containing categories',
      required: false,
      default: 'src/assets/categories.json'
    }),
    bundles: Flags.string({
      char: 'b',
      description: 'JSON file to load containing bundles',
      required: false,
      default: 'src/assets/bundles.json'
    }),
    db: Flags.string({
      char: 'd',
      description: 'database to load into',
      default: 'mongodb://localhost:27017/damplab',
      required: false
    }),
    serviceCollection: Flags.string({
      char: 'S',
      description: 'collection to load services into',
      default: 'damplabservices',
      required: false
    }),
    categoryCollection: Flags.string({
      char: 'C',
      description: 'collection to load categories into',
      default: 'categories',
      required: false
    }),
    bundleCollection: Flags.string({
      char: 'B',
      description: 'collection to load bundles into',
      default: 'bundles',
      required: false
    })
  };

  client: MongoClient | null = null;
  flags: any;

  async run(): Promise<void> {
    const { flags } = await this.parse(LoadDatabase);
    this.flags = flags;

    // Connect to the database
    this.client = await MongoClient.connect(flags.db);
    await this.client.connect();

    // Insert the services into the database
    const idMap = await this.insertServices(services);

    // Insert the categories into the database
    await this.insertCategories(categories, idMap, services);

    // Insert the bundles into the database
    await this.insertBundles(bundles, idMap);

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
   *
   * @returns A map of the old service IDs to the new service IDs
   */
  async insertServices(services: any[]): Promise<Map<string, ObjectId>> {
    /** Maps the ID as defined in the JSON file to the ID in the database */
    const serviceMap = new Map<string, ObjectId>();
    // For each of the services, save the info not including
    // the allowed connections
    for (const service of services) {
      // Get a copy of the data without the allowed connections and id
      const copy = { ...service };
      copy.description = copy.description || '';
      delete copy.allowedConnections;
      delete copy.id;

      // Insert the service into the database
      const result = await this.client?.db().collection(this.flags.serviceCollection).insertOne(copy);

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
        .collection(this.flags.serviceCollection)
        .updateOne(
          {
            name: service.name
          },
          {
            $set: { allowedConnections: allowedConnections }
          }
        );
    }

    return serviceMap;
  }

  async insertCategories(categories: any[], serviceMap: Map<string, ObjectId>, services: any[]): Promise<void> {
    const categoryMap = new Map<string, ObjectId>();
    for (const category of categories) {
      const result = await this.client?.db().collection(this.flags.categoryCollection).insertOne(category);
      categoryMap.set(category.id, result.insertedId);
    }

    for (const category of categories) {
      const serviceList = services.filter((service: any) => service.categories.includes(category.id)).map((service: any) => serviceMap.get(service.id));
      await this.client
        ?.db()
        .collection(this.flags.categoryCollection)
        .updateOne({ _id: categoryMap.get(category.id) }, { $set: { services: serviceList } });
    }
  }

  async insertBundles(bundles: any[], serviceMap: Map<string, ObjectId>): Promise<void> {
    for (const bundle of bundles) {
      bundle.services = this.convertIDs(bundle.services, serviceMap);
      await this.client?.db().collection(this.flags.bundleCollection).insertOne(bundle);
    }
  }

  private convertIDs(ids: string[], serviceMap: Map<string, ObjectId>): ObjectId[] {
    return ids.map((id) => {
      if (!serviceMap.has(id)) {
        throw new Error(`${id} not found in service map`);
      }
      return serviceMap.get(id);
    });
  }
}
