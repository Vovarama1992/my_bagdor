import { PrismaService } from '../src/PrismaModule/prisma.service';
import { ConfigService } from '@nestjs/config';
import { DbRegion } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

async function main() {
  const configService = new ConfigService();
  const prismaService = new PrismaService(configService); // 🔹 Передаем ConfigService

  const adminEmail = 'vovvarls@gmail.com';
  const adminPhone = '+79684042508';
  const adminPassword = 'Bfoan3592_';
  const dbRegion: DbRegion = 'RU'; // 🔹 Укажи, в какую БД добавлять ('RU', 'OTHER', 'PENDING')

  console.log(`⏳ Подключаемся к базе ${dbRegion}...`);
  const prisma = prismaService.getDatabase(dbRegion);

  // Проверяем, есть ли уже админ
  const existingAdmin = await prisma.user.findFirst({
    where: {
      OR: [{ email: adminEmail }, { phone: adminPhone }],
      accountType: 'ADMIN',
    },
  });

  if (existingAdmin) {
    console.log(
      `✅ Админ уже существует в ${dbRegion}: ${existingAdmin.email}`,
    );
    return;
  }

  // Хешируем пароль
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  // Создаем админа
  const newAdmin = await prisma.user.create({
    data: {
      email: adminEmail,
      phone: adminPhone,
      nickname: 'vokevo',
      firstName: 'Admin',
      lastName: 'User',
      password: hashedPassword,
      accountType: 'ADMIN',
      isEmailVerified: true,
      isPhoneVerified: true,
      isRegistered: true,
      dbRegion: dbRegion,
    },
  });

  console.log(`✅ Админ создан в ${dbRegion}: ${newAdmin.email}`);

  await prismaService.onModuleDestroy(); // Закрываем соединение
}

main().catch((e) => {
  console.error('❌ Ошибка при создании админа:', e);
});
