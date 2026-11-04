# Assets for `demos/visuals.html`

All files here were generated for this demo and are released into the public domain (CC0 1.0).

- `tv-test-pattern.webm`: 320x180, 15 fps, 6 seconds, VP8 video with an Opus 440 Hz tone. Generated with FFmpeg:
  `ffmpeg -f lavfi -i "testsrc2=size=320x180:rate=15:duration=6" -f lavfi -i "sine=frequency=440:duration=6:sample_rate=48000" -filter:a "volume=0.15" -c:v libvpx -b:v 250k -c:a libopus -b:a 32k tv-test-pattern.webm`
- `fence-alpha.jpg`: 256x256 greyscale alpha map, white with black diamond holes, for `alpha-test` cut-outs.
- `fade-alpha.jpg`: 64x256 greyscale alpha map, opaque at the top fading to clear at the bottom.

The alpha maps are JPEG rather than PNG so that they are not stored in Git LFS.
