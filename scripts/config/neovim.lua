-- Tuxedo neovim configuration (neovim.lua)

-- disable builtin file browser
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

-- set termguicolors to enable highlight groups
vim.opt.termguicolors = true

vim.opt.wildmode = "longest:full,full"
vim.opt.wildmenu = true

vim.opt.number = true
vim.opt.wrap = true

vim.cmd([[ let g:neo_tree_remove_legacy_commands = 1 ]])
vim.cmd('colorscheme habamax')

-- spacing and indentation
vim.opt.tabstop = 2
vim.opt.expandtab = true
vim.opt.shiftwidth = 2
vim.opt.list = true

local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable",
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup({{
  "nvim-neo-tree/neo-tree.nvim",
    branch = "v3.x",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-tree/nvim-web-devicons",
      "MunifTanjim/nui.nvim",
    },
  },{
  "nvim-telescope/telescope.nvim", tag = "0.1.5",
     dependencies = { "nvim-lua/plenary.nvim" }
  }
})

-- ripgrep is required for live_grep and grep_string
-- sudo apt install ripgrep
require('telescope').setup{
  defaults = {
    file_ignore_patterns = {
      "node_modules", "package-lock.json"
    }
  }
}

vim.cmd(':Neotree')
