#!/bin/bash

echo "Pushing to PENDING"
DATABASE_URL=$DATABASE_URL_PENDING npx prisma db push

echo "Pushing to OTHER"
DATABASE_URL=$DATABASE_URL_OTHER npx prisma db push

echo "Pushing to RU"
DATABASE_URL=$DATABASE_URL_RU npx prisma db push

echo "✅ All done"