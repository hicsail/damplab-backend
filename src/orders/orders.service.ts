import { Injectable } from '@nestjs/common';
import { Order } from './models/order.model';
import { Node } from './models/node.model';
import { Edge } from './models/edge.model';

/**
 * Placeholder service for testing GraphQL integration. Stores an array of
 * orders in memory and provides methods to retrieve and modify them.
 */
@Injectable()
export class OrdersService {
  // TODO: Remove once database is added in
  private orders: Order[] = [
    {
      id: '1',
      name: 'Order 1',
      description: 'Order 1 description',
      nodes: [
        {
          id: '1',
        },
        {
          id: '2',
        },
      ],
      edges: [
        {
          id: '1',
          origin: {
            id: '1',
          },
          destination: {
            id: '2',
          },
          properties: {
            weight: 1,
          },
        },
      ],
    }
  ];

  /**
   * Returns all orders.
   */
  findAll(): Promise<Order[]> {
    return Promise.resolve(this.orders);
  }

  /**
   * Create a new order
   */
  create(order: Order): Promise<Order> {
    this.orders.push(order);
    return Promise.resolve(order);
  }

  /**
   * Add a node to an order
   */
  addNode(orderId: string, node: Node): Promise<Node> {
    const order = this.orders.find(order => order.id === orderId);

    if (!order) {
      throw new Error(`Order with id ${orderId} not found`);
    }

    order.nodes.push(node);
    return Promise.resolve(node);
  }

  /**
   * Add an edge to an order
   * @param orderId
   * @param edge
   */
  addEdge(orderId: string, edge: Edge): Promise<Edge> {
    const order = this.orders.find(order => order.id === orderId);

    if (!order) {
      throw new Error(`Order with id ${orderId} not found`);
    }

    order.edges.push(edge);
    return Promise.resolve(edge);
  }

}
