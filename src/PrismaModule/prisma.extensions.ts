import { Logger } from '@nestjs/common';

const logger = new Logger('PrismaExtensions');

export const prismaExtensions = {
  model: {
    $allModels: {
      findMany(args?: any) {
        logger.log(`findMany called. Original args: ${JSON.stringify(args)}`);

        if (!this.fields.includes('isDeleted')) {
          return (this as any).findMany(args);
        }

        if (!args) {
          args = {};
        }
        if (!args.where) {
          args.where = {};
        }

        if (args.where.isDeleted === undefined) {
          args.where.isDeleted = false;
        }

        logger.log(`findMany updated args: ${JSON.stringify(args)}`);
        return (this as any).findMany(args);
      },

      findFirst(args?: any) {
        logger.log(`findFirst called. Original args: ${JSON.stringify(args)}`);

        if (!this.fields.includes('isDeleted')) {
          return (this as any).findFirst(args);
        }

        if (!args) {
          args = {};
        }
        if (!args.where) {
          args.where = {};
        }

        if (args.where.isDeleted === undefined) {
          args.where.isDeleted = false;
        }

        logger.log(`findFirst updated args: ${JSON.stringify(args)}`);
        return (this as any).findFirst(args);
      },
    },
  },
};
