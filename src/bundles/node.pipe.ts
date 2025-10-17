import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { BundleNode } from './models/node.model';
import { BundleNodeService } from './services/node.service';

@Injectable()
export class BundleNodePipe implements PipeTransform<string, Promise<BundleNode>> {
  constructor(private readonly nodeService: BundleNodeService) {}

  async transform(value: string): Promise<BundleNode> {
    try {
      const node = await this.nodeService.getByID(value);
      if (node) {
        return node;
      }
    } catch (e) {}

    throw new BadRequestException(`BundleNode with ID ${value} does not exist`);
  }
}
