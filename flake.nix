{
  description = "mc-sim: Game-state hub for the nerima-games Minecraft-clone rebuild: entities, inventory, time, the frame loop, and the authoritative CameraPoseSnapshot.";

  inputs = {
    # nixos-unstable, not nixpkgs-unstable: it advances only after the NixOS
    # release tests pass, so it is less likely to land a broken build.
    #
    # flake.lock is pinned to rev 624af665 (2026-07-26) rather than the
    # channel head: every revision from 2026-08-28 onward ships oxlint
    # >=1.79.0, whose `no-redeclare` rule false-positives on the `type X` /
    # `const X = Brand.refined<X>(...)` branded-type idiom. Proven by A/B
    # testing oxlint 1.75.0 vs 1.79.0 against the same source tree. Re-check
    # on the next bump.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      # Only what is actually exercised: x86_64-linux by CI, aarch64-darwin by
      # the maintainer. Declaring a platform nothing builds makes
      # `nix flake check --all-systems` fail rather than skip it.
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          # Node 24 matches the `engines` field and the CI runner. pnpm comes
          # from corepack rather than nixpkgs so that the version is decided by
          # the `packageManager` field in package.json — one source of truth
          # instead of two that can drift.
          #
          # oxlint is declared in package.json and pnpm-lock.yaml so CI and local
          # installs resolve the same CLI. The devShell supplies the same command
          # for editor workflows; packageManager/Corepack remains the install
          # source of truth.
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.corepack_24
              pkgs.typescript-language-server
              pkgs.oxlint
              pkgs.ast-grep
            ];

            shellHook = ''
              corepackDir="$(mktemp -d "''${TMPDIR:-/tmp}/mc-sim-corepack.XXXXXX")"
              corepack enable --install-directory "$corepackDir"
              export PATH="$corepackDir:$PATH"
            '';
          };
        }
      );
    };
}
