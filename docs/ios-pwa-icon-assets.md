# Утверждённая иконка Family Hub для iOS PWA

Утверждён визуальный вариант: белый дом с галочкой, маленькая звезда справа сверху, бирюзово-зелёный градиент. PNG-изображения подготовлены в переписке и собраны в архив `family-hub-ios-icons.zip`.

## Файлы

- `frontend/public/icons/apple-touch-icon.png` — 180×180, для iOS.
- `frontend/public/icons/icon-192.png` — 192×192, PWA.
- `frontend/public/icons/icon-512.png` — 512×512, PWA.
- `icon-1024.png` — исходник, можно сохранить вне frontend/public.

**Требуется загрузить бинарные PNG в ветку.** Манифест и HTML уже ссылаются на эти пути. Не деплоить эту ветку, пока PNG не добавлены в GitHub и не возвращают HTTP 200.

## Локальное добавление

Извлечь архив `family-hub-ios-icons.zip` рядом с клонированным репозиторием и выполнить:

```sh
mkdir -p frontend/public/icons
cp ../family-hub-ios-icons/apple-touch-icon.png frontend/public/icons/
cp ../family-hub-ios-icons/icon-192.png frontend/public/icons/
cp ../family-hub-ios-icons/icon-512.png frontend/public/icons/
git add frontend/public/icons/*.png
git commit -m "feat(pwa): add approved Family Hub PNG icons"
git push origin feature/ios-pwa
```

## Контроль

Проверить `/manifest.webmanifest`, `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/apple-touch-icon.png` и установку Safari → «На экран Домой». Иконка не должна содержать поля интерфейса редактора или кнопку «Поделиться».
