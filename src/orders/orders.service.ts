import { Injectable } from '@nestjs/common';
import { Order } from './models/order.model';
import { DampNode, DampNodeType } from './models/node.model';
import { Edge } from './models/edge.model';
import { NewOrderInput } from './dto/new-order.input';
import { AddNodeInput } from './dto/add-node.input';

/**
 * Placeholder service for testing GraphQL integration. Stores an array of
 * orders in memory and provides methods to retrieve and modify them.
 */
@Injectable()
export class OrdersService {
  // TODO: Remove once database is added in
  private testNodes = [
    {
      id: '1',
      nodeType: DampNodeType.PIPETTE,
      volume: 10
    },
    {
      id: '2',
      nodeType: DampNodeType.PIPETTE,
      volume: 20
    },
    {
      id: '3',
      nodeType: DampNodeType.MIXER,
      speed: 100
    }
  ];

  private orders: Order[] = [
    {
      id: '1',
      name: 'Order 1',
      description: 'Order 1 description',
      nodes: this.testNodes,
      edges: [
        {
          id: '1',
          origin: this.testNodes[0],
          destination: this.testNodes[1],
          properties: {
            weight: 1
          }
        },
        {
          id: '2',
          origin: this.testNodes[1],
          destination: this.testNodes[2],
          properties: {
            weight: 2
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
  addNode(addNode: AddNodeInput, nodeType: DampNodeType): Promise<DampNode> {
    const order = this.orders.find((order) => order.id === addNode.orderId);

    if (!order) {
      throw new Error(`Order with id ${addNode.orderId} not found`);
    }

    // TODO: Generate an ID for the node
    const node = {
      id: (order.nodes.length + 1).toString(),
      nodeType: nodeType,
      ...addNode.node
    };

    order.nodes.push(node);
    return Promise.resolve(node);
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
