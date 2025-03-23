CONTAINER=backend_app_1

push-pending:
	docker exec -it $(CONTAINER) bash -c "DATABASE_URL=$$DATABASE_URL_PENDING npx prisma db push"

push-other:
	docker exec -it $(CONTAINER) bash -c "DATABASE_URL=$$DATABASE_URL_OTHER npx prisma db push"

push-ru:
	docker exec -it $(CONTAINER) bash -c "DATABASE_URL=$$DATABASE_URL_RU npx prisma db push"

push-all: push-pending push-other push-ru