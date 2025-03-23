CONTAINER=backend_app_1

push-pending:
	docker exec -it $(CONTAINER) bash -c "DATABASE_URL=postgres://postgres:password123@database-pending:5432/hmm_pending npx prisma db push"

push-other:
	docker exec -it $(CONTAINER) bash -c "DATABASE_URL=postgres://postgres:password123@database-other:5432/hmm_other npx prisma db push"

push-ru:
	docker exec -it $(CONTAINER) bash -c "DATABASE_URL=postgres://postgres:password123@database-ru:5432/hmm_ru npx prisma db push"

push-all: push-pending push-other push-ru