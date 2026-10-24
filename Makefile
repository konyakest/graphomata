.PHONY: test diff all gif clean

test:
	python3 -m unittest discover -s tests
	node web/test.js
	node web/smoke.js
	node web/ptr/test.js
	node web/ptr/smoke.js

diff:
	./tools/gmj diff

all: test diff
	./tools/gmj all

gif:
	./tools/gmj gif levels/03-reverse.json examples/py/03_reverse.py --out docs/reverse.gif
	./tools/gmj sheet levels/03-reverse.json examples/py/03_reverse.py --out docs/reverse-sheet.png

serve:
	./tools/serve

clean:
	rm -rf .build
