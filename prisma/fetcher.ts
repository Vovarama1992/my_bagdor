import * as fs from 'fs';
import * as path from 'path';
import * as csv from 'csv-parser';

// Путь к файлу с аэропортами
const airportsFile = path.join(__dirname, 'airports.csv');
const outputFile = path.join(__dirname, 'cities_with_airports.json');

// Карта для хранения городов, стран и их аэропортов
const citiesMap = new Map<string, { country: string; airports: Set<string> }>();

fs.createReadStream(airportsFile)
  .pipe(csv())
  .on('data', (row) => {
    const city = row['municipality']; // Город
    const country = row['iso_country']; // Код страны (например, "US", "FR", "RU")
    const iataCode = row['iata_code']; // Код аэропорта IATA
    const type = row['type']; // Тип аэропорта

    // Фильтр: Только крупные аэропорты + города
    if (city && iataCode && type === 'large_airport' && country) {
      if (!citiesMap.has(city)) {
        citiesMap.set(city, { country, airports: new Set() });
      }
      citiesMap.get(city)!.airports.add(iataCode);
    }
  })
  .on('end', () => {
    // Форматируем результат в JSON
    const result = Array.from(citiesMap, ([city, data]) => ({
      city,
      country: data.country, // Добавляем страну
      airports: Array.from(data.airports),
    }));

    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`✅ JSON сохранён в ${outputFile}`);
  })
  .on('error', (err) => {
    console.error(`❌ Ошибка при чтении файла: ${err.message}`);
  });
