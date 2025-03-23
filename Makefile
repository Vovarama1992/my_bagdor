push-pending:
	docker exec -it backend bash -c "DATABASE_URL=$$DATABASE_URL_PENDING npx prisma db push"

push-other:
	docker exec -it backend bash -c "DATABASE_URL=$$DATABASE_URL_OTHER npx prisma db push"

push-ru:
	docker exec -it backend bash -c "DATABASE_URL=$$DATABASE_URL_RU npx prisma db push"

push-all: push-pending push-other push-ru