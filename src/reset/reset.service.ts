import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ServiceInput } from './dtos/service.dto';
import { CategoryInput } from './dtos/category.dto';
import { BundleInput } from './dtos/bundle.dto';
import { Model, Types } from 'mongoose';
import { DampLabService, DampLabServiceDocument } from '../services/models/damplab-service.model';
import { Category, CategoryDocument } from '../categories/category.model';
import { Bundle, BundleDocument } from '../bundles/bundles.model';

@Injectable()
export class ResetService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(DampLabService.name) private readonly serviceModel: Model<DampLabServiceDocument>,
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(Bundle.name) private readonly bundleModel: Model<BundleDocument>
  ) {}

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

    // Insert the categories
    const categoryMap = await this.insertCategories(categories);

    // Update the categories to have the service list using the categories
    // field on the service
    await this.updateServiceList(categories, categoryMap, services, serviceMap);

    // Save the bundles
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
        price: service.price,
        pricingMode: service.pricingMode,
        parameters: service.parameters,
        allowedConnections: [],
        result: service.result,
        description: service.description,
        resultParams: service.resultParams,
        paramGroups: service.paramGroups
      });

      // Update the map
      serviceMap.set(service.id, result._id);
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

      // Update the map
      categoryMap.set(category.id, result._id);
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
