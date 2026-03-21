.PHONY: install-ts install-py run-ts run-py check-ts

install-ts:
	npm install

install-py:
	python3 -m venv .venv
	. .venv/bin/activate && pip install -e .[dev]

run-ts:
	npm run dev

run-py:
	. .venv/bin/activate && marketing-fox-py

check-ts:
	npm run check
