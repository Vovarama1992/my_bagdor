# Используем официальный Node.js образ
FROM node:18

# Устанавливаем ffmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json для установки зависимостей
COPY package*.json ./

# Устанавливаем зависимости с безопасными правами
RUN npm install --unsafe-perm --allow-root

# Копируем остальные файлы проекта
COPY . .

# Генерируем Prisma Client для всех схем
RUN npm run prisma:generate

# Собираем приложение
RUN npm run build

# Открываем порты (если приложение слушает на порту 3001)
EXPOSE 3001

# Запускаем контейнер
CMD ["sh", "-c", "npm run start:dev"]