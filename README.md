# lease-lens
Lease Lens helps first-time renters explore and compare Toronto apartment building quality using RentSafeTO evaluation data.

## Data explorer (Milestone 3)

To open the data exploration dashboard, run these from this folder:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/explorer/ in your browser. Press Ctrl + C in the terminal to stop the server. See [explorer/README.md](explorer/README.md) for details.

## Story: temporal chapter (Prototype V1)

With the server above running, open http://localhost:8000/story/temporal.html. The design notes, interaction spec and copy are in [docs/temporal-chapter.md](docs/temporal-chapter.md). To re-check the quoted numbers, run `python3 scripts/validate_temporal.py`.
