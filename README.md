# Clean Page

A web page that behaves like a sheet of paper in a typewriter. Open it, type, print (or save to a local file).

Writing lasts only while the page is open. Closing or reloading the tab clears it; save or download a file to keep your work. Only font, size, and color preferences persist.

## Principles

- Calm and without distractions
- Free to use and free to take (open source)
- Privacy-first: no user data is ever collected by the application
- Chromebook-biased: built and tuned for Chromebooks, but works in any modern browser
- First-class accessibility

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Sponsored by [ChirpWater LLC](https://chirpwater.com).

## Builds

`npm run build` produces a development edition. Release builds use `CP_BUILD_REF=v0.2.0 npm run build` (substitute the release tag). The dev deployment sets `CP_BUILD_REF=main`; production checks out and builds the published release tag. Manual production deployments require a release tag.

Product information and statements are maintained at [www.cleanpage.org](https://www.cleanpage.org).
