import { UseGuards } from '@nestjs/common';
import { Resolver, Query, ResolveField, Parent, ID, Args, Mutation, Float } from '@nestjs/graphql';
import { CreateServicePipe } from './create.pipe';
import { DampLabServicePipe } from './damplab-services.pipe';
import { DampLabServices } from './damplab-services.services';
import { CreateService } from './dtos/create.dto';
import { ServiceChange } from './dtos/update.dto';
import { DampLabService } from './models/damplab-service.model';
import { ServiceUpdatePipe } from './update.pipe';

import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { hasPermission } from '../auth/permissions/permissions';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { CustomerCategory } from '../pricing/customer-category';
import { Pricing } from '../pricing/pricing.model';
import { visibleExternalFallbackPrice, visibleFlatPrice, visiblePricing, callerCustomerCategory, canSeeAllPricingTiers } from '../pricing/pricing-visibility';
import { effectivePricingMode, resolveCategoryPrice } from '../pricing/service-pricing.util';
import { ServicePricingMode } from './models/damplab-service.model';
import { CatalogServiceView } from './dtos/catalog-service-view.dto';
import { ParameterSet } from '../parameter-sets/parameter-set.model';

@Resolver(() => DampLabService)
@UseGuards(AuthRolesGuard)
export class DampLabServicesResolver {
  constructor(private readonly dampLabServices: DampLabServices) {}

  /**
   * The wide catalog. Deliberately open (`catalog:view` is baseline) — the canvas
   * cannot render a node without it, and it is fetched once into the frontend's
   * global AppContext. The narrowing that matters happens on its *fields*, below.
   */
  @Query(() => [DampLabService])
  async services(): Promise<DampLabService[]> {
    return this.dampLabServices.findAll();
  }

  /**
   * The client-facing catalog page, as a reduced query rather than a filtered view
   * of the wide one.
   *
   * The page used to read `AppContext.services` and render all four pricing tiers
   * plus a parameters dialog to every authenticated user. Here the caller gets one
   * price — their own, resolved server-side from their pricing group — and the tier
   * table and parameter definitions come back null without `internal-fields:read`.
   */
  @Query(() => [CatalogServiceView], { description: 'The services catalog as the caller may see it: their own price, and the full tier table only with internal-fields:read.' })
  @RequirePermission(Permission.CatalogView)
  async catalogServices(@CurrentUser() user: User): Promise<CatalogServiceView[]> {
    const services = await this.dampLabServices.findAll();
    const category = callerCustomerCategory(user);
    const seesEverything = canSeeAllPricingTiers(user);
    // Retired operations reach only the people who retire them. Server-side,
    // because the page is a client page and its filter is only presentation.
    const seesHidden = hasPermission(user, Permission.CatalogEditorRead);

    return services
      .filter((service) => seesHidden || service.hiddenFromClients !== true)
      .map((service) => {
        const pricesPerParameter = effectivePricingMode(service) === ServicePricingMode.PARAMETER;
        return {
          id: String((service as any)._id ?? (service as any).id),
          name: service.name,
          description: service.description,
          serviceCategoryName: service.serviceCategoryName,
          unit: service.unit,
          // Per-parameter services have no single number to quote: the price depends
          // on what the customer picks. Say so rather than showing a misleading base.
          price: pricesPerParameter ? undefined : resolveCategoryPrice(service as any, category),
          pricingModeLabel: pricesPerParameter ? 'Based on selected options' : 'Operation price',
          parameterCount: Array.isArray(service.parameters) ? service.parameters.length : 0,
          pricing: seesEverything ? service.pricing : undefined,
          parameters: seesEverything ? service.parameters : undefined,
          hiddenFromClients: service.hiddenFromClients === true
        };
      });
  }

  @Query(() => [ID], { description: 'Ids of soft-deleted operations. The operations spreadsheet upload uses it to tell "deleted" from "unknown".' })
  @RequirePermission(Permission.CatalogEditorRead)
  deletedServiceIds(): Promise<string[]> {
    return this.dampLabServices.findDeletedIds();
  }

  @Mutation(() => DampLabService)
  @RequirePermission(Permission.CatalogEditorWrite)
  async updateService(
    @Args('service', { type: () => ID }, DampLabServicePipe) service: DampLabService,
    @Args('changes', { type: () => ServiceChange }, ServiceUpdatePipe) changes: ServiceChange
  ): Promise<DampLabService> {
    return this.dampLabServices.update(service, changes);
  }

  @Mutation(() => Boolean)
  @RequirePermission(Permission.CatalogEditorWrite)
  async deleteService(@Args('service', { type: () => ID }, DampLabServicePipe) service: DampLabService): Promise<boolean> {
    await this.dampLabServices.delete(service);
    return true;
  }

  @Mutation(() => DampLabService)
  @RequirePermission(Permission.CatalogEditorWrite)
  async createService(@Args('service', CreateServicePipe) service: CreateService): Promise<DampLabService> {
    return this.dampLabServices.create(service);
  }

  /**
   * Resolver which the `allowedConnections` field of the `DampLabService`
   * type. Allows for the recursive search on possible connections.
   */
  @ResolveField()
  allowedConnections(@Parent() service: DampLabService): Promise<DampLabService[]> {
    return this.dampLabServices.findByIds(service.allowedConnections);
  }

  /** As strings: the stored ObjectIds serialize through `ID` anyway, this makes it explicit. */
  @ResolveField(() => [ID])
  parameterSetIds(@Parent() service: DampLabService): string[] {
    return (service.parameterSetIds ?? []).map((id) => String(id));
  }

  /**
   * `services` admits every authenticated caller (see above), and a nested field
   * has no gate of its own by default — so without this check a client could ask
   * `services { parameterSets { name description } }` and read what the design's
   * permission table limits to catalog-editor:read, going around the server-side
   * gate on the `parameterSets`/`parameterSet` root queries.
   */
  @ResolveField(() => [ParameterSet])
  parameterSets(@Parent() service: DampLabService, @CurrentUser() user: User): Promise<ParameterSet[]> {
    if (!hasPermission(user, Permission.CatalogEditorRead)) return Promise.resolve([]);
    return this.dampLabServices.findParameterSetsFor(service);
  }

  /**
   * Free-text staff notes. The field has always been documented "Not shown to
   * customers"; nothing enforced it until now.
   *
   * Nulled by permission rather than removed from the query, because `GET_SERVICES`
   * is one shared document driving both the canvas and the catalog page, and staff
   * read and edit `notes` through it (`AdminEditService`). Deleting the field would
   * strip it from staff too.
   */
  @ResolveField(() => String, { nullable: true })
  notes(@Parent() service: DampLabService, @CurrentUser() user: User): string | undefined {
    return hasPermission(user, Permission.InternalFieldsRead) ? service.notes : undefined;
  }

  /**
   * **The catalog leak, closed.** `services` has no `@Roles` — deliberately, the
   * canvas needs it — and it carried all four pricing tiers to every authenticated
   * caller, clients included, because the canvas and the catalog page share one
   * query. A reduced `catalogServices` alone would not have fixed that: the wide
   * query would still have been sitting there.
   *
   * Without `internal-fields:read` a caller now sees their own tier plus the generic
   * `external` / `legacy` fallbacks, and null everywhere else.
   */
  @ResolveField(() => Pricing, { nullable: true })
  pricing(@Parent() service: DampLabService, @CurrentUser() user: User): Pricing | undefined {
    return visiblePricing(service.pricing, user);
  }

  // The five deprecated flat price fields carry the same information and are still
  // populated on older documents, so leaving them would make the strip above
  // cosmetic. Same rule, field by field.

  @ResolveField(() => Float, { nullable: true })
  internalPrice(@Parent() service: DampLabService, @CurrentUser() user: User): number | undefined {
    return visibleFlatPrice(service.internalPrice, CustomerCategory.INTERNAL_CUSTOMERS, user);
  }

  @ResolveField(() => Float, { nullable: true })
  externalAcademicPrice(@Parent() service: DampLabService, @CurrentUser() user: User): number | undefined {
    return visibleFlatPrice(service.externalAcademicPrice, CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC, user);
  }

  @ResolveField(() => Float, { nullable: true })
  externalMarketPrice(@Parent() service: DampLabService, @CurrentUser() user: User): number | undefined {
    return visibleFlatPrice(service.externalMarketPrice, CustomerCategory.EXTERNAL_CUSTOMER_MARKET, user);
  }

  @ResolveField(() => Float, { nullable: true })
  externalNoSalaryPrice(@Parent() service: DampLabService, @CurrentUser() user: User): number | undefined {
    return visibleFlatPrice(service.externalNoSalaryPrice, CustomerCategory.EXTERNAL_CUSTOMER_NO_SALARY, user);
  }

  /**
   * `externalPrice` is the flat twin of `pricing.external`: the pre-split
   * undifferentiated external rate that all three external chains fall back to.
   * External and uncategorised callers need it; internal customers never read it
   * and, on real records, it carries an actual external rate — so they do not get
   * it.
   */
  @ResolveField(() => Float, { nullable: true })
  externalPrice(@Parent() service: DampLabService, @CurrentUser() user: User): number | undefined {
    return visibleExternalFallbackPrice(service.externalPrice, user);
  }
}
