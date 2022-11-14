import { Injectable } from '@nestjs/common';
import { Order } from './models/order.model';
import { Node, NodeType } from './models/nodes/node.model';
import { Edge } from './models/edge.model';
import { NewOrderInput } from './dto/new-order.input';
import { AddNodeInput } from './dto/add-node.input';
import { Mixer } from './models/nodes/mixer.model';
import { Pipette } from './models/nodes/pipette.model';

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
        nodeType: NodeType.PIPETTE,
        volume: 10
      } as Pipette,
      {
        id: '2',
        nodeType: NodeType.PIPETTE,
        volume: 20
      } as Pipette,
      {
        id: '3',
        nodeType: NodeType.MIXER,
        speed: 100
      } as Mixer,
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
  addNode(addNode: AddNodeInput): Promise<Node> {
    const order = this.orders.find((order) => order.id === addNode.orderId);

    if (!order) {
      throw new Error(`Order with id ${addNode.orderId} not found`);
    }

    // order.nodes.push({ id: addNode.nodeId, nodeType: addNode.nodeType });
    return Promise.resolve({ id: addNode.nodeId, nodeType: addNode.nodeType });
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
