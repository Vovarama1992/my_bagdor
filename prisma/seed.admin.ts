import { PrismaService } from '../src/PrismaModule/prisma.service';
import { ConfigService } from '@nestjs/config';
import { DbRegion } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

async function main() {
  const configService = new ConfigService();
  const prismaService = new PrismaService(configService);
  const dbRegion: DbRegion = 'RU';
  const prisma = prismaService.getDatabase(dbRegion);

  const adminEmail = 'admin@example.com';
  const adminPassword = 'Pass123$';

  // Удаляем существующего пользователя с таким email
  const existing = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (existing) {
    await prisma.user.delete({ where: { email: adminEmail } });
    console.log(`🗑️ Удалён старый пользователь с email ${adminEmail}`);
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const newAdmin = await prisma.user.create({
    data: {
      email: adminEmail,
      phone: '+70000000000',
      nickname: 'admin2',
      firstName: 'Admin',
      lastName: 'Example',
      password: hashedPassword,
      accountType: 'ADMIN',
      isEmailVerified: true,
      isPhoneVerified: true,
      isRegistered: true,
      dbRegion,
    },
  });

  console.log(`✅ Новый админ создан: ${newAdmin.email}`);

  await prismaService.onModuleDestroy();
}

main().catch((e) => {
  console.error('❌ Ошибка при создании админа:', e);
});
