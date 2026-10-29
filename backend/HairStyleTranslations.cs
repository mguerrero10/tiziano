namespace StudentHub.Api;

public static class HairStyleTranslations
{

    // TO DO traducciones faltantes para los estilo de corte de pelo
    private static readonly Dictionary<string, string> YouCamTitles = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Dark Brown Flow"] = "Flow castaño oscuro",
        ["Soft Bowl"] = "Bowl suave",
        ["Textured Flow"] = "Flow texturizado",
        ["Dark Parted Bangs"] = "Flequillo con raya",
        ["S-Wave Brunette"] = "Ondas S castañas",
        ["Dark Wooly Curls"] = "Rulos definidos oscuros",
        ["Soft Chestnut Midcut"] = "Medio castaño suave",
        ["Wavy Undercut"] = "Undercut ondulado",
        ["Rainbow Waves"] = "Ondas arcoíris",
        ["Rainbow Bob"] = "Bob arcoíris",
        ["Pride Curls"] = "Rulos pride",
        ["Blonde Buzz Cut"] = "Buzz rubio",
        ["Relaxed Waves"] = "Ondas relajadas",
        ["Surfer Waves"] = "Ondas surfer",
        ["Layered Curls"] = "Rulos en capas",
        ["Defined Curls"] = "Rulos definidos",
        ["Center-Parted Style"] = "Raya al centro",
        ["Long Straight Black"] = "Liso largo negro",
        ["Blended Blonde Fade"] = "Fade rubio difuminado",
        ["Pink Textured Crop"] = "Crop texturizado rosa",
        ["Messy Surfer Cut"] = "Surfer despeinado",
        ["Dark Cornrows"] = "Cornrows oscuras",
        ["Short Box Braids"] = "Box braids cortas",
        ["Layered Bob"] = "Bob en capas",
        ["Medium Tousled Waves"] = "Ondas medias desordenadas",
        ["Modern Slick Back"] = "Peinado hacia atrás",
        ["Curtain"] = "Cortina",
        ["Long Wavy"] = "Largo ondulado",
        ["Short Curly Indigo"] = "Rizado corto índigo",
        ["Crewcut Purple"] = "Crew cut violeta",
        ["Long Wavy Blond"] = "Largo rubio ondulado",
        ["Bald"] = "Calvo",
        ["Bowlcut"] = "Bowl cut",
        ["Light Brown Wisps"] = "Mechones castaño claro",
        ["Brown Wavy Undercut"] = "Undercut ondulado castaño",
        ["Side-Part Straight"] = "Liso con raya lateral",
        ["Short Curly"] = "Rizado corto",
        ["Sleek Middle Part"] = "Raya al medio pulido",
        ["Combover"] = "Peinado lateral",
        ["Gray Taper Fade"] = "Taper fade gris",
        ["Textured Crop"] = "Crop texturizado",
        ["Textured Comma"] = "Comma texturizado",
        ["Messy Tapered Fade"] = "Taper fade despeinado",
        ["Side-Swept Undercut"] = "Undercut lateral",
        ["Pink Blue Fade"] = "Fade rosa y azul",
        ["Buzz Cut"] = "Buzz cut / rapado",
        ["Tousled Cut"] = "Corte despeinado",
        ["Crewcut"] = "Crew cut",
        ["Hippie Wave"] = "Ondas hippie",
        ["Dreadlocks"] = "Dreadlocks",
    };

    public static string Translate(string title) =>
        YouCamTitles.TryGetValue(title, out var translated) ? translated : title;
}
