.PHONY: seed demo test

seed:
	@echo "Loading RailRadar/NTES capture into local database..."
	python scripts/seed_db.py
	@echo "Done."

demo:
	@echo "Launching RippleETA in Replay Mode..."
	docker compose up --build
