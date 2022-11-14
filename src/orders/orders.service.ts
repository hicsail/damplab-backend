import { Injectable } from '@nestjs/common';
import { Order } from './models/order.model';
import { Node } from './models/node.model';
import { Edge } from './models/edge.model';
import {NewOrderInput} from './dto/new-order.input';
import {AddNodeInput} from './dto/add-node.input';

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
          id: '1'
        },
        {
          id: '2'
        }
      ],
      edges: [
        {
          id: '1',
          origin: {
            id: '1'
          },
          destination: {
            id: '2'
          },
          properties: {
            weight: 1
          }
        }
      ]
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
  create(newOrder: NewOrderInput): Promise<Order> {
    const order: Order = {
      id: (this.orders.length + 1).toString(),
      name: newOrder.name,
      description: newOrder.description,
      nodes: [],
      edges: []
    };

    this.orders.push(order);
    return Promise.resolve(order);
  }

  /**
   * Add a node to an order
   */
  addNode(addNode: AddNodeInput): Promise<Node> {
    const order = this.orders.find((order) => order.id === addNode.orderId);

    if (!order) {
      throw new Error(`Order with id ${addNode.orderId} not found`);
    }

    order.nodes.push({ id: addNode.nodeId });
    return Promise.resolve({ id: addNode.nodeId });
  }

  /**
   * Add an edge to an order
   * @param orderId
   * @param edge
   */
  addEdge(orderId: string, edge: Edge): Promise<Edge> {
    const order = this.orders.find((order) => order.id === orderId);

    if (!order) {
      throw new Error(`Order with id ${orderId} not found`);
    }

    order.edges.push(edge);
    return Promise.resolve(edge);
  }
}
