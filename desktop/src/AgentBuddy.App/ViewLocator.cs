using AgentBuddy.App.ViewModels;
using AgentBuddy.App.Views;
using Avalonia.Controls;
using Avalonia.Controls.Templates;

namespace AgentBuddy.App;

/// <summary>Explicit VM → View map (no reflection, so a missing screen fails to compile).</summary>
public sealed class ViewLocator : IDataTemplate
{
    public bool Match(object? data) => data is ScreenViewModel;

    public Control? Build(object? data) => data switch
    {
        LoginViewModel vm => new LoginView { DataContext = vm },
        WorkspaceViewModel vm => new WorkspaceView { DataContext = vm },
        ThreadListViewModel vm => new ThreadListView { DataContext = vm },
        ThreadViewModel vm => new ThreadView { DataContext = vm },
        TaskListViewModel vm => new TaskListView { DataContext = vm },
        TaskTraceViewModel vm => new TaskTraceView { DataContext = vm },
        OrgViewModel vm => new OrgView { DataContext = vm },
        ChannelsViewModel vm => new ChannelsView { DataContext = vm },
        ConnectorsViewModel vm => new ConnectorsView { DataContext = vm },
        SettingsViewModel vm => new SettingsView { DataContext = vm },
        ComputersViewModel vm => new ComputersView { DataContext = vm },
        SchedulesViewModel vm => new SchedulesView { DataContext = vm },
        PersonaViewModel vm => new PersonaView { DataContext = vm },
        KnowledgeViewModel vm => new KnowledgeView { DataContext = vm },
        FilesViewModel vm => new FilesView { DataContext = vm },
        ConnectViewModel vm => new ConnectView { DataContext = vm },
        AboutViewModel vm => new AboutView { DataContext = vm },
        _ => new TextBlock { Text = "Unknown screen" }
    };
}
