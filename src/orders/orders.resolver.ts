import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { OrdersService } from './orders.service';
import { Order } from './models/order.model';
import { NewOrderInput } from './dto/new-order.input';

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

  /*
  @Mutation(() => Node)
  async addNode(@Args('addNode') addNode: AddNodeInput): Promise<Node> {
    return this.ordersService.addNode(addNode);
  }
  */
}
