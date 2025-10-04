export const metadata = {
  title: "git-worktree-toolbox",
  description: "Git Worktree Toolbox",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="bg-[black] min-h-screen p-20 grid w-full">
          {children}
        </div>
      </body>
    </html>
  );
}
