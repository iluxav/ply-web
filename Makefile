.PHONY: build release

build:
	npm ci && npm run build

# bump ply.toml, commit, tag, push — the tag ALWAYS matches the version.
# `make release V=0.5.0` overrides the patch bump.
release:
	@set -eu; \
	test "$$(git rev-parse --abbrev-ref HEAD)" = main || { echo "release: not on main"; exit 1; }; \
	test -z "$$(git status --porcelain)" || { echo "release: working tree not clean"; exit 1; }; \
	git pull --ff-only; \
	CUR=$$(sed -n 's/^version = "\(.*\)"/\1/p' ply.toml | head -1); \
	V="$(V)"; \
	[ -n "$$V" ] || V=$$(echo "$$CUR" | awk -F. '{print $$1"."$$2"."$$3+1}'); \
	echo "$$V" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$$' || { echo "release: bad version \`$$V\`"; exit 1; }; \
	echo "release: $$CUR -> $$V"; \
	sed -i "s/^version = \".*\"/version = \"$$V\"/" ply.toml; \
	git add ply.toml; \
	git commit -m "v$$V"; \
	git push; \
	git tag "v$$V"; \
	git push origin "v$$V"; \
	echo "release: v$$V tagged — CI builds the image; prod pulls it within a beat"
