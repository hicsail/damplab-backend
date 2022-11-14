import { Query, Resolver } from '@nestjs/graphql';
import { OrdersService } from './orders.service';
import { Order } from './models/order.model';

@Resolver((_of: any) => Order)
export class OrdersResolver {

  constructor(private readonly ordersService: OrdersService) {}

  @Query(() => [Order])
  async orders(): Promise<Order[]> {
    return this.ordersService.findAll();
  }
}
