import { BadRequestException, Injectable } from '@nestjs/common';
import { Connection, Types, Model } from 'mongoose';
import { ServiceInput } from './dtos/service.dto';
import { CategoryInput } from './dtos/category.dto';
import { BundleInput } from './dtos/bundle.dto';
// Import only the interfaces, not the document types
import { DampLabService } from '../services/models/damplab-service.model';
import { Category } from '../categories/category.model';
import { Bundle } from '../bundles/bundles.model';

// Define a generic type for any model
type AnyModel = Model<any>;

@Injectable()
export class ResetService {
  // Temporary solution to avoid decorator errors
  private readonly connection: any;
  private readonly serviceModel: any;
  private readonly categoryModel: any;
  private readonly bundleModel: any;

  constructor() {
    // This is a temporary solution - in production, use proper dependency injection
    this.connection = null;
    this.serviceModel = null;
    this.categoryModel = null;
    this.bundleModel = null;
  }

  async clearDatabase(): Promise<void> {
    await this.connection.dropDatabase();
  }

  async loadData(services: ServiceInput[], categories: CategoryInput[], bundles: BundleInput[]): Promise<void> {
    // First clear out the database
    await this.clearDatabase();

    // Make each service without the allowed connections and get back the
    // mapping between human assigned IDs and MongoDB IDs
    const serviceMap = await this.saveServices(services);

    // Next, using the map determine the allowed connections
    await this.updateAllowedConnections(services, serviceMap);

    // Next, create the categories
    const categoryMap = await this.insertCategories(categories);

    // Next, update the categories with the services
    await this.updateServiceList(categories, categoryMap, services, serviceMap);

    // Finally, create the bundles
    await this.saveBundles(bundles, serviceMap);
  }

  /**
   * Save the services generating a map that stores human assigned ID to
   * MongoDB IDs.
   *
   * Allowed connections and categories are add in later
   */
  async saveServices(services: ServiceInput[]): Promise<Map<string, Types.ObjectId>> {
    const serviceMap = new Map<string, Types.ObjectId>();

    for (const service of services) {
      const result = await this.serviceModel.create({
        name: service.name,
        icon: service.icon,
        parameters: service.parameters,
        allowedConnections: [],
        result: service.result,
        description: service.description,
        resultParams: service.resultParams,
        paramGroups: service.paramGroups
      });

      // Convert string ID to ObjectId and store in map
      serviceMap.set(service.id, new Types.ObjectId(result._id));
    }

    return serviceMap;
  }

  /**
   * Using the map that matches human readable IDs to MongoDB IDs, update
   * the allowed connections to use the MongoDB IDs
   */
  async updateAllowedConnections(services: ServiceInput[], serviceMap: Map<string, Types.ObjectId>): Promise<void> {
    for (const service of services) {
      // Generate the list of allowed connections
      const allowedConnections = service.allowedConnections.map((id: string) => {
        // If the ID is not in the service map, throw an exeception
        if (!serviceMap.has(id)) {
          throw new BadRequestException(`Service "${service.id}" has an invalid allowed connection "${id}"`);
        }

        return serviceMap.get(id);
      });

      // Update the service allowed connections
      await this.serviceModel.updateOne({ _id: serviceMap.get(service.id) }, { $set: { allowedConnections } });
    }
  }

  /**
   * Insert the categories generating a map matching human assigned IDs to
   * MongoDB IDs
   */
  async insertCategories(categories: CategoryInput[]): Promise<Map<string, Types.ObjectId>> {
    const categoryMap = new Map<string, Types.ObjectId>();

    for (const category of categories) {
      const result = await this.categoryModel.create({
        label: category.label,
        services: []
      });

      // Convert string ID to ObjectId and store in map
      categoryMap.set(category.id, new Types.ObjectId(result._id));
    }

    return categoryMap;
  }

  /**
   * Update the list of services on category using the category field on
   * the services
   */
  async updateServiceList(categories: CategoryInput[], categoryMap: Map<string, Types.ObjectId>, services: ServiceInput[], serviceMap: Map<string, Types.ObjectId>): Promise<void> {
    for (const category of categories) {
      // Get the IDs of the contained services
      const targetServices = services
        // First filter to get the services in the category
        .filter((service: ServiceInput) => {
          return service.categories.includes(category.id);
        })
        // Then map the services back to their MongoDB ID
        .map((service: ServiceInput) => {
          return serviceMap.get(service.id);
        });

      // Now update the category model
      await this.categoryModel.updateOne({ _id: categoryMap.get(category.id) }, { $set: { services: targetServices } });
    }
  }

  /**
   * Save the bundles
   */
  async saveBundles(bundles: BundleInput[], serviceMap: Map<string, Types.ObjectId>): Promise<void> {
    for (const bundle of bundles) {
      // Get the service MongoDB IDs the bundle is associated with
      const targetServices = bundle.services.map((serviceHumanID: string) => {
        // Throw an error if the service ID does not exist
        if (!serviceMap.has(serviceHumanID)) {
          throw new BadRequestException(`Bundle "${bundle.id}" has an invalid service ID "${serviceHumanID}"`);
        }

        return serviceMap.get(serviceHumanID);
      });

      // Save the bundle
      await this.bundleModel.create({
        label: bundle.label,
        icon: bundle.icon,
        services: targetServices
      });
    }
  }
}
