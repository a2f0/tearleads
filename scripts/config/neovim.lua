-- Tuxedo neovim configuration (neovim.lua)

-- Disable ShaDa to prevent corruption from multiple concurrent neovim instances
vim.opt.shadafile = "NONE"

-- Auto-reload files when changed externally (e.g., git pull)
vim.opt.autoread = true
vim.opt.updatetime = 1000  -- Check for changes every 1 second of idle

-- Check for file changes on various events (FocusGained may not fire in screen/tmux)
vim.api.nvim_create_autocmd({"FocusGained", "BufEnter", "CursorHold", "CursorHoldI"}, {
  pattern = "*",
  callback = function()
    if vim.fn.mode() ~= 'c' then
      vim.cmd('checktime')
    end
  end,
})

-- Timer-based file change detection (for screen/tmux where FocusGained doesn't fire)
local timer = vim.uv.new_timer()
if timer then
  timer:start(2000, 2000, vim.schedule_wrap(function()
    if vim.fn.mode() ~= 'c' and vim.bo.buftype == '' then
      vim.cmd('silent! checktime')
    end
  end))
end

-- Keybinding to reload this config file: <leader>r
vim.keymap.set('n', '<leader>r', function()
  local config_path = vim.env.MYVIMRC or vim.fn.stdpath('config') .. '/init.lua'
  -- Try to source the file that was used to start nvim
  local init_file = vim.v.argv[3]  -- Usually the -u argument
  if init_file and vim.fn.filereadable(init_file) == 1 then
    vim.cmd('source ' .. init_file)
    print('Reloaded: ' .. init_file)
  elseif vim.fn.filereadable(config_path) == 1 then
    vim.cmd('source ' .. config_path)
    print('Reloaded: ' .. config_path)
  else
    print('Could not find config to reload')
  end
end, { desc = 'Reload neovim config' })

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

-- spacing and indentation
vim.opt.tabstop = 2
vim.opt.expandtab = true
vim.opt.shiftwidth = 2
vim.opt.list = true

local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.uv.fs_stat(lazypath) then
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

require("lazy").setup({
  {
    "folke/tokyonight.nvim",
    lazy = false,
    priority = 1000,
    opts = {
      style = "night",
      transparent = false,
    },
  },
  {
    "nvim-neo-tree/neo-tree.nvim",
    branch = "v3.x",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-tree/nvim-web-devicons",
      "MunifTanjim/nui.nvim",
    },
    opts = {
      filesystem = {
        use_libuv_file_watcher = true,
        filtered_items = {
          visible = true,
          hide_dotfiles = false,
          hide_gitignored = false,
        },
      },
      git_status = {
        window = {
          position = "float",
        },
      },
    },
  },
  {
    "nvim-telescope/telescope.nvim",
    tag = "0.1.8",
    dependencies = { "nvim-lua/plenary.nvim" },
  },
})

-- Set colorscheme after plugins load
vim.cmd('colorscheme tokyonight-night')

-- ripgrep is required for live_grep and grep_string
-- brew install ripgrep (macOS) or apt install ripgrep (Linux)
require('telescope').setup{
  defaults = {
    file_ignore_patterns = {
      "node_modules", "package-lock.json"
    }
  }
}

vim.cmd(':Neotree')
