.PHONY: install-ts install-py install-browser run-ts run-py check-ts xhs-login xhs-check

install-ts:
	npm install

install-py:
	python3 -m venv .venv
	. .venv/bin/activate && pip install -e .[dev]

install-browser:
	. .venv/bin/activate && python -m playwright install chromium

run-ts:
	npm run dev

run-py:
	. .venv/bin/activate && marketing-fox-py

xhs-login:
	npm run xhs:login

xhs-check:
	npm run xhs:check

check-ts:
	npm run check
