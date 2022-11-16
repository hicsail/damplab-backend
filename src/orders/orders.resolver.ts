import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { OrdersService } from './orders.service';
import { Order } from './models/order.model';
import { NewOrderInput } from './dto/new-order.input';
import { AddPipetteNodeInput, AddMixerNodeInput } from './dto/add-node.input';
import { DampNode, DampNodeType } from './models/node.model';

@Resolver(() => Order)
export class OrdersResolver {
  constructor(private readonly ordersService: OrdersService) {}

  @Query(() => [Order])
  async orders(): Promise<Order[]> {
    return this.ordersService.findAll();
  }

  @Mutation(() => Order)
  async createOrder(@Args('newOrder') newOrder: NewOrderInput): Promise<Order> {
    return this.ordersService.create(newOrder);
  }

  @Mutation(() => DampNode)
  async addPipetteNode(@Args('newNode') newNode: AddPipetteNodeInput): Promise<DampNode> {
    return this.ordersService.addNode(newNode, DampNodeType.PIPETTE);
  }

  @Mutation(() => DampNode)
  async addMixerNode(@Args('newNode') newNode: AddMixerNodeInput): Promise<DampNode> {
    return this.ordersService.addNode(newNode, DampNodeType.MIXER);
  }
}
